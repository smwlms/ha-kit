// Room sensor (kamersensor) v2 - rounded "pebble" case for ESP32 DevKit + HLK-LD2450 + BH1750 + GY-SHT31-D.
// Flat back against the wall; the LD2450 sits tilted INSIDE the case (ld_tilt degrees down),
// so no wedge is needed. 24 GHz radar sees through the plastic front without problems:
// keep it PLA/PETG, no metal-, carbon- or "silk"-filled filament, and no paint in front of the radar.
//
// Two chambers: top = ESP32 (on the lid) + radar + light sensor, bottom = SHT31 with its own vents,
// so the heat of the ESP32 (rising) does not bias the temperature. The USB cable leaves at the bottom rear.
//
// part = "preview" | "body" | "lid"  -> export body and lid to STL separately.
// Print: body with the back opening UP (flat rim on top, dome on a brim or with tree supports), or
// lid flat (wall side down). PETG/PLA, 0.2 mm, 3 walls. All sizes in mm - MEASURE your boards first.

/* [Part] */
part = "preview"; // [preview, body, lid]
show_beam = true; // radar beam in the preview

/* [Shell] */
W = 66;          // outer width  (x)
H = 78;          // outer height (z)
D = 40;          // outer depth  (y), wall -> front
R = 12;          // corner / dome radius
wall = 1.8;      // wall thickness (also in front of the radar)
chamber_h = 17;  // inner height of the lower SHT31 chamber (from the inner floor)
div_t = 1.6;

/* [Boards] */
ld = [44, 15, 1.2];      // LD2450 width, height, pcb
ld_tilt = 15;            // radar points this many degrees down
ld_zc = 38;              // centre height of the radar board (from outer bottom)
bh = [13.9, 18.5, 1.6];  // BH1750 (GY-302)
bh_zc = 60;
bh_chip = [0, 4];        // chip offset from the board centre (x, z) -> light hole
sht = [13, 10, 1.6];     // GY-SHT31-D
esp = [51.5, 28.5, 1.6]; // ESP32 DevKit
esp_zc = 52;             // centre height of the ESP32 on the lid
esp_standoff = 3;

/* [Mount] */
keyhole_head = 8.5;
keyhole_shank = 4.2;

$fn = 64;
clr = 0.3;
lid_t = 2.4;   // lid plate thickness
plug = 4;      // depth of the lid plug into the body

// ---------------------------------------------------------------- shell shapes

// rounded pebble: domed front (spheres), straight sides towards the flat back (cylinders)
module pebble(w, h, d, r, y0 = 0) {
  hull() {
    for (x = [r, w - r], z = [r, h - r]) {
      translate([x, y0 + r, z]) sphere(r = r);
      translate([x, d - 0.01, z]) rotate([-90, 0, 0]) cylinder(r = r, h = 0.01);
    }
  }
}
module outer() { pebble(W, H, D, R); }
module inner() { translate([wall, 0, wall]) pebble(W - 2 * wall, H - 2 * wall, D + 1, R - wall, wall); }

// back cross-section (for the lid)
module back_profile(off = 0) {
  offset(r = off) translate([wall, wall]) offset(r = R - wall) offset(delta = -(R - wall)) square([W - 2 * wall, H - 2 * wall]);
}

// ---------------------------------------------------------------- holders

// Snap clips for a board: a column to the front wall (trimmed by the inner shell), a side wall
// around each board edge and a 0.6 mm snap nub behind the pcb. Board is pushed in from the back.
module board_clips(size, zc, tilt, dist) {
  t = size[2] + 2 * clr;
  intersection() {
    inner();
    translate([W / 2, dist, zc]) rotate([-tilt, 0, 0]) for (s = [-1, 1]) {
      e = s * (size[0] / 2 + clr);            // board edge
      // column towards the front wall
      translate([s > 0 ? e - 3 : e - 1.2, -25, -size[1] / 2 + 2]) cube([4.2, 25, size[1] - 4]);
      // side wall beside the edge
      translate([s > 0 ? e : e - 1.2, 0, -size[1] / 2 + 2]) cube([1.2, t + 1.2, size[1] - 4]);
      // snap nub behind the pcb
      translate([s > 0 ? e - 0.6 : e, t, -size[1] / 2 + 2]) cube([0.6, 0.8, size[1] - 4]);
    }
  }
}

module keyhole() {
  translate([0, 0, -1]) cylinder(d = keyhole_head, h = lid_t - 0.8 + 1);            // head pocket (blind)
  translate([0, 0, -1]) hull() { cylinder(d = keyhole_shank, h = 20); translate([0, 7, 0]) cylinder(d = keyhole_shank, h = 20); }
  translate([0, 0, -1]) hull() { cylinder(d = keyhole_head, h = lid_t - 0.8); translate([0, 7, 0]) cylinder(d = keyhole_head, h = lid_t - 0.8); }
}

// ---------------------------------------------------------------- body

ld_y = 6;   // distance of the radar pcb from the inside of the front (at its centre)

module body() {
  difference() {
    union() {
      difference() { outer(); inner(); translate([-1, D - 0.01, -1]) cube([W + 2, 10, H + 2]); }
      // divider between the chambers, wire/cable notches at the back corners
      intersection() {
        inner();
        difference() {
          translate([0, 0, wall + chamber_h]) cube([W, D - plug - 0.5, div_t]);
          translate([wall + 3, D - plug - 9, 0]) cube([7, 9, H]);          // sensor wires
          translate([W - wall - 12, D - plug - 9, 0]) cube([9, 9, H]);     // USB cable down
        }
      }
      board_clips(ld, ld_zc, ld_tilt, ld_y);
      board_clips(bh, bh_zc, 0, 2.5);
      // SHT31 cradle on the floor, sensor facing the front vents
      intersection() {
        inner();
        translate([W / 2 - sht[0] / 2 - 1.2, 9, wall - 1]) difference() {
          cube([sht[0] + 2.4, sht[2] + 2 * clr + 2.4, 5]);
          translate([1.2 - clr, 1.2, 2]) cube([sht[0] + 2 * clr, sht[2] + 2 * clr, 5]);
        }
      }
    }
    // light hole for the BH1750 (straight through the dome)
    translate([W / 2 + bh_chip[0], -1, bh_zc + bh_chip[1]]) rotate([-90, 0, 0]) cylinder(d = 4, h = 12);
    // vents of the sensor chamber: underside + lower front (curved slots)
    for (i = [-3 : 3]) translate([W / 2 + i * 6, D / 2 - 4, -1]) hull() {
      translate([0, -9, 0]) cylinder(d = 2.4, h = wall + 3);
      translate([0, 9, 0]) cylinder(d = 2.4, h = wall + 3);
    }
    for (i = [-3 : 3]) translate([W / 2 + i * 6, -1, wall + 4]) hull() {
      rotate([-90, 0, 0]) cylinder(d = 2.4, h = 12);
      translate([0, 0, chamber_h - 9]) rotate([-90, 0, 0]) cylinder(d = 2.4, h = 12);
    }
    // heat vents on top, towards the back (away from the radar)
    for (i = [-3 : 3]) translate([W / 2 + i * 6, D - 18, H - wall - 2]) hull() {
      cylinder(d = 2.4, h = wall + 4);
      translate([0, 9, 0]) cylinder(d = 2.4, h = wall + 4);
    }
    // USB cable exit: bottom rear edge, right side
    translate([W - wall - 11, D - 5, -1]) cube([7, 6, wall + 2]);
    // snap holes for the lid bumps (left/right, hidden near the wall)
    for (x = [-1, W - wall - 1]) translate([x, D - plug / 2, H / 2]) rotate([0, 90, 0]) cylinder(d = 2.2, h = wall + 2);
  }
}

// ---------------------------------------------------------------- lid

module lid() {
  difference() {
    union() {
      // flange (flush with the outline) + plug into the body
      translate([0, D + lid_t, 0]) rotate([90, 0, 0]) linear_extrude(lid_t) back_profile(wall);
      translate([0, D, 0]) rotate([90, 0, 0]) linear_extrude(plug) difference() {
        back_profile(-clr);
        back_profile(-clr - 1.4);
      }
      for (x = [wall + clr, W - wall - clr]) translate([x, D - plug / 2, H / 2]) sphere(d = 1.8, $fn = 16);
      // ESP32 cradle (component side to the front)
      translate([W / 2 - esp[0] / 2 - clr - 1.2, D - esp_standoff, esp_zc - esp[1] / 2 - clr - 1.2]) difference() {
        cube([esp[0] + 2 * clr + 2.4, esp_standoff, esp[1] + 2 * clr + 2.4]);
        translate([1.2, -1, 1.2]) cube([esp[0] + 2 * clr, esp_standoff, esp[1] + 2 * clr]);
        translate([8, -1, -1]) cube([esp[0] - 16, esp_standoff + 2, esp[1] + 6]);
      }
    }
    // keyholes, cut from the wall side
    for (z = [H * 0.3, H * 0.7]) translate([W / 2, D + lid_t + 0.01, z]) rotate([90, 0, 0]) keyhole();
    // USB notch in the flange, matches the body exit
    translate([W - wall - 11, D - 1, -1]) cube([7, lid_t + 2, wall + 5]);
  }
}

// ---------------------------------------------------------------- preview

module ghosts() {
  color("seagreen", 0.9) translate([W / 2, ld_y, ld_zc]) rotate([-ld_tilt, 0, 0]) translate([-ld[0] / 2, 0, -ld[1] / 2]) cube([ld[0], ld[2], ld[1]]);
  color("purple", 0.9) translate([W / 2 - bh[0] / 2, 2.5, bh_zc - bh[1] / 2]) cube([bh[0], bh[2], bh[1]]);
  color("orange", 0.9) translate([W / 2 - sht[0] / 2, 10.2 + clr, wall + 1]) cube([sht[0], sht[2], sht[1] + 8.4]);
  color("royalblue", 0.9) translate([W / 2 - esp[0] / 2, D - esp_standoff - esp[2], esp_zc - esp[1] / 2]) cube([esp[0], esp[2], esp[1]]);
  color("black", 0.8) for (z = [esp_zc - esp[1] / 2 + 0.5, esp_zc + esp[1] / 2 - 3]) translate([W / 2 - esp[0] / 2 + 2, D - esp_standoff - esp[2] - 12, z]) cube([38, 12, 2.5]);
  // radar beam (for orientation only)
  if (show_beam) color("red", 0.12) translate([W / 2, ld_y, ld_zc]) rotate([-ld_tilt, 0, 0]) rotate([90, 0, 0]) cylinder(r1 = 4, r2 = 60, h = 90);
}

if (part == "body") translate([0, 0, D]) rotate([-90, 0, 0]) body();      // back opening up
else if (part == "lid") translate([0, 0, D + lid_t]) rotate([-90, 0, 0]) lid();
else {
  color("white", 0.45) body();
  color("gainsboro", 0.8) translate([0, 20, 0]) lid();                   // exploded 20 mm
  ghosts();
}
