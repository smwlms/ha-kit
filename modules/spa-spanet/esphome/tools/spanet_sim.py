#!/usr/bin/env python3
"""SpaNET SV3 simulator - pretends to be the spa on EXP1 so the spa ESP32 can be tested on a desk.

Speaks the plain-text EXP1 protocol at 38400 8N1 (see ../spanet.h and wayne-love/espyspa):
  RF            -> status registers R2..RG (one per line, \\r\\n)
  W40:nnn       -> set temperature (nnn = degC x 10, 50..410)       reply "nnn"
  W66:n         -> mode 0 NORM, 1 ECON, 2 AWAY, 3 WEEK               reply "n"
  W63:n         -> power save 0 off, 1 low, 2 high                  reply "n"
  W64:v / W65:v -> power save begin / end (h*256+m)                  reply "v"
  W60:n / W90:n -> filtration hours / cycle                          reply "n"
  W12           -> sanitise (CLEAN) cycle                            reply "W12"
  S2x:n         -> pumps                                             reply "S2x-OK"

Thermal model: 5.25 kW heater into `--volume` litres, heat loss to `--ambient` (lid on).
Heating follows the spa rules: NORM heats below setpoint (0.2 K hysteresis), AWAY never,
ECON only while filtering; Power Save HIGH and sleep timers block heating and filtration.

Wiring for the desk test (USB-serial adapter must be 3.3 V TTL, e.g. CP2102):
  adapter TXD -> ESP32 GPIO16 (RX2)    adapter RXD <- ESP32 GPIO17 (TX2)    GND <-> GND
  (the 330 ohm resistors may stay in). Power the ESP32 from its own USB port.

Usage:
  python3 spanet_sim.py --port /dev/cu.usbserial-0001 [--speed 60]   # real serial port
  python3 spanet_sim.py --pty                                        # virtual port (prints its path)
  python3 spanet_sim.py --dump [--water 35.5 --setpoint 38]          # print one RF reply and exit
  python3 spanet_sim.py --selftest                                   # protocol test over a pty
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import select
import sys
import time
from dataclasses import dataclass, field

HEATER_W = 5250.0
PUMP_W = 350.0
MODES = ["NORM", "ECON", "AWAY", "WEEK"]


def hm(v: int) -> tuple[int, int]:
    return (v // 256) % 24, (v % 256) % 60


def in_window(now_min: int, begin: int, end: int) -> bool:
    b, e = begin[0] * 60 + begin[1], end[0] * 60 + end[1]
    return b <= now_min < e if b <= e else (now_min >= b or now_min < e)


@dataclass
class Spa:
    water: float = 36.0
    setpoint: float = 38.0
    mode: int = 0
    psav: int = 2                    # HIGH, as configured on the touchpad
    psav_begin: int = 17 * 256       # 17:00
    psav_end: int = 23 * 256         # 23:00
    sleep1: tuple[int, int, int] = (127, 6 * 256, 10 * 256)  # all days 06:00-10:00
    sleep2: tuple[int, int, int] = (128, 22 * 256, 7 * 256)  # disabled (128 = off)
    filt_hours: int = 4
    filt_cycle: int = 4
    volume_l: float = 1400.0
    ambient: float = 12.0
    loss_k_per_h: float = 0.012      # fraction of (water - ambient) lost per hour, lid on
    heating: bool = False
    filtering: bool = False
    sanitise_until: float = 0.0
    energy_kwh: float = 0.0
    energy_today_kwh: float = 0.0
    sim_time: dt.datetime = field(default_factory=dt.datetime.now)

    # -- spa logic -------------------------------------------------------------------------
    def blocked(self) -> bool:
        now_min = self.sim_time.hour * 60 + self.sim_time.minute
        if self.psav == 2 and in_window(now_min, hm(self.psav_begin), hm(self.psav_end)):
            return True
        for days, b, e in (self.sleep1, self.sleep2):
            if days != 128 and in_window(now_min, hm(b), hm(e)):
                return True
        return False

    def step(self, seconds: float):
        blocked = self.blocked()
        # filtration: filt_hours per day, spread over cycles of filt_cycle hours
        per_cycle = self.filt_hours / max(1, 24 // self.filt_cycle)
        hour_in_cycle = (self.sim_time.hour % self.filt_cycle) + self.sim_time.minute / 60
        self.filtering = (not blocked) and hour_in_cycle < per_cycle
        want = self.water < self.setpoint - (0.2 if not self.heating else -0.1)
        mode = MODES[self.mode]
        if mode == "WEEK":
            mode = "AWAY" if self.sim_time.weekday() < 4 else "NORM"
        if mode == "AWAY":
            want = False
        elif mode == "ECON":
            want = want and self.filtering
        self.heating = want and not blocked
        # thermal model
        heat_w = HEATER_W if self.heating else 0.0
        loss_w = self.loss_k_per_h / 3600 * (self.water - self.ambient) * self.volume_l * 4186
        self.water += (heat_w - loss_w) * seconds / (self.volume_l * 4186)
        power = heat_w + (PUMP_W if (self.heating or self.filtering) else 0.0)
        kwh = power * seconds / 3.6e6
        self.energy_kwh += kwh
        before = self.sim_time
        self.sim_time += dt.timedelta(seconds=seconds)
        self.energy_today_kwh = kwh if self.sim_time.date() != before.date() else self.energy_today_kwh + kwh

    @property
    def power_w(self) -> float:
        return (HEATER_W if self.heating else 0.0) + (PUMP_W if (self.heating or self.filtering) else 0.0)

    # -- protocol --------------------------------------------------------------------------
    def rf(self) -> str:
        t = self.sim_time
        status = "Heating" if self.heating else ("Filtering" if self.filtering else "Waiting")
        ec = round(HEATER_W / 240 * 10) if self.heating else 0
        amps = round((self.power_w / 240) * 10)
        wt = round(self.water * 10)
        r2 = [amps, 240, 38, 70, t.isoweekday() % 7, t.hour, t.minute, t.second, t.day, t.month, t.year,
              round(self.water * 10 + (15 if self.heating else 0)), 9999, 1, 0, 490, 207, 34, 6000, 602, 23, 20, 0, 0, 0, 0, 44, 35, 45]
        r3 = [32, 1, 4, 4, 4, "SW V5 17 05 31", "SV3", "18480001", "20000826", 1, 0, 0, 0, 0, 0, "NA", 7, 0, 470,
              status, 4, ec, 7, 7, 0, 0]
        r4 = [MODES[self.mode], 0, 0, 0, 1, 0, 3547, 4, 20, round(self.power_w), round(self.energy_kwh * 100),
              round(self.energy_today_kwh * 1000 / 10), 1686, 0, 8388608, 0, 0, 5, 0, 98, 0, 10084, 4, 80, 100, 0, 0, 4]
        r5 = [0, 1, 0, 1, 0, 0, 0, 0, 0, int(self.blocked()), 1, int(self.heating), int(self.filtering), 0, wt,
              int(time.time() < self.sanitise_until), 3, 4, 0, 0, 0, 0, 0, 1, 2, 6]
        r6 = [1, 5, 0, 2, 5, self.filt_hours, self.filt_cycle, round(self.setpoint * 10), 1, self.psav,
              self.psav_begin, self.psav_end, self.sleep1[0], self.sleep2[0], self.sleep1[1], self.sleep2[1],
              self.sleep1[2], self.sleep2[2], 0, 30, 0, 0, 1, 0, 2, 3, 0]
        lines = [
            "RF:",
            ",R2," + ",".join(map(str, r2)) + ",:",
            ",R3," + ",".join(map(str, r3)) + ",:",
            ",R4," + ",".join(map(str, r4)) + ",:",
            ",R5," + ",".join(map(str, r5)) + ",:",
            ",R6," + ",".join(map(str, r6)) + ",:",
            ",R7,2304,0,1,1,1,0,1,0,0,0,253,191,253,240,483,125,77,1,0,0,0,23,200,1,0,1,31,32,35,100,5,:",
            ",R9,F1,255,0,0,0,0,0,0,0,0,0,0,:",
            ",RA,F2,0,0,0,0,0,0,255,0,0,0,0,:",
            ",RB,F3,0,0,0,0,0,0,0,0,0,0,0,:",
            ",RC,0,1,1,0,0,0,0,0,0,2,0,0,1,0,:",
            ",RE,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,-4,13,30,8,5,1,0,0,0,0,0,:*",
            ",RG,1,1,1,1,1,1,1-1-014,1-1-01,1-1-01,0-,0-,0,:*",
        ]
        return "\r\n".join(lines) + "\r\n"

    def handle(self, cmd: str) -> str | None:
        cmd = cmd.strip()
        if not cmd:
            return None
        if cmd == "RF":
            return self.rf()
        try:
            if cmd == "W12":
                self.sanitise_until = time.time() + 20 * 60
                return "W12\r\n"
            key, _, val = cmd.partition(":")
            if key.startswith("S2") and len(key) == 3:
                return f"{key}-OK\r\n"
            v = int(val)
            if key == "W40" and 50 <= v <= 410:
                self.setpoint = v / 10
            elif key == "W66" and 0 <= v <= 3:
                self.mode = v
            elif key == "W63" and 0 <= v <= 2:
                self.psav = v
            elif key == "W64":
                self.psav_begin = v
            elif key == "W65":
                self.psav_end = v
            elif key == "W60" and 1 <= v <= 24:
                self.filt_hours = v
            elif key == "W90" and v in (1, 2, 3, 4, 6, 8, 12, 24):
                self.filt_cycle = v
            else:
                return "?\r\n"
            return f"{val}\r\n"
        except ValueError:
            return "?\r\n"


# ------------------------------------------------------------------------------------ runner


def serve(fd_read, fd_write, spa: Spa, speed: float, verbose: bool = True):
    buf = b""
    last = time.time()
    last_print = 0.0
    while True:
        r, _, _ = select.select([fd_read], [], [], 0.2)
        now = time.time()
        spa.step((now - last) * speed)
        last = now
        if verbose and now - last_print > 10:
            last_print = now
            print(f"[{spa.sim_time:%a %H:%M}] water {spa.water:5.2f} C  set {spa.setpoint:4.1f}  "
                  f"{MODES[spa.mode]}  psav {spa.psav}  {'HEATING' if spa.heating else '       '}  "
                  f"{'filtering' if spa.filtering else ''}  {spa.power_w:5.0f} W", flush=True)
        if not r:
            continue
        data = os.read(fd_read, 1024)
        if not data:
            continue
        buf += data
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            cmd = line.decode(errors="replace").strip("\r ")
            reply = spa.handle(cmd)
            if reply is None:
                continue
            if verbose and cmd != "RF":
                print(f"  <- {cmd}   -> {reply.strip()}", flush=True)
            os.write(fd_write, reply.encode())


def open_pty():
    import tty

    master, slave = os.openpty()
    tty.setraw(master)
    tty.setraw(slave)
    return master, slave, os.ttyname(slave)


def selftest() -> int:
    spa = Spa(water=35.0, setpoint=38.0)
    master, slave, path = open_pty()
    pid = os.fork()
    if pid == 0:  # child = the spa
        try:
            serve(master, master, spa, speed=1, verbose=False)
        finally:
            os._exit(0)
    ok = True
    try:
        def ask(cmd: str, timeout=2.0) -> str:
            os.write(slave, (f"\n{cmd}\n").encode())
            out, end = b"", time.time() + timeout
            while time.time() < end:
                r, _, _ = select.select([slave], [], [], 0.1)
                if r:
                    out += os.read(slave, 4096)
                    if cmd != "RF" or b",RG," in out:
                        time.sleep(0.05)
                        break
            return out.decode()

        checks = [
            ("W40:385", lambda o: o.strip() == "385"),
            ("W66:1", lambda o: o.strip() == "1"),
            ("W63:0", lambda o: o.strip() == "0"),
            ("W12", lambda o: o.strip() == "W12"),
            ("S22:1", lambda o: o.strip() == "S22-OK"),
            ("W40:999", lambda o: o.strip() == "?"),
            ("RF", lambda o: ",R6,1,5,0,2,5,4,4,385," in o and ",R4,ECON," in o and ",R5," in o),
        ]
        for cmd, check in checks:
            out = ask(cmd)
            good = check(out)
            ok &= good
            first = out.strip().splitlines()[0] if out.strip() else "(no reply)"
            print(f"{'OK  ' if good else 'FAIL'}  {cmd:8} -> {first[:60]}")
    finally:
        os.kill(pid, 9)
    print("selftest:", "passed" if ok else "FAILED")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", help="serial port of the USB-serial adapter, e.g. /dev/cu.usbserial-0001")
    ap.add_argument("--pty", action="store_true", help="create a virtual serial port instead")
    ap.add_argument("--dump", action="store_true", help="print one RF reply and exit")
    ap.add_argument("--selftest", action="store_true", help="run the protocol self-test and exit")
    ap.add_argument("--speed", type=float, default=60.0, help="simulated seconds per real second (default 60)")
    ap.add_argument("--water", type=float, default=36.0)
    ap.add_argument("--setpoint", type=float, default=38.0)
    ap.add_argument("--ambient", type=float, default=12.0)
    ap.add_argument("--volume", type=float, default=1400.0, help="water volume in litres")
    a = ap.parse_args()
    spa = Spa(water=a.water, setpoint=a.setpoint, ambient=a.ambient, volume_l=a.volume)
    if a.selftest:
        return selftest()
    if a.dump:
        spa.step(0)
        sys.stdout.write(spa.rf())
        return 0
    if a.pty:
        master, _slave, path = open_pty()
        print(f"Virtual spa on {path}  (38400 baud, Ctrl+C to stop)")
        serve(master, master, spa, a.speed)
    if a.port:
        try:
            import serial  # pyserial
        except ImportError:
            print("pyserial is missing: pip install pyserial   (or: uv run --with pyserial spanet_sim.py ...)")
            return 1
        ser = serial.Serial(a.port, 38400, timeout=0)
        print(f"Spa simulator on {a.port} (38400 8N1), time x{a.speed:g}. Ctrl+C to stop.")
        serve(ser.fileno(), ser.fileno(), spa, a.speed)
    ap.print_help()
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        pass
