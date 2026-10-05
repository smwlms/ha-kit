"""One command that tests the whole kit; exit 0 = everything passed, anything else = at least one failure.

  uv run --with-requirements tools/requirements.txt python tools/check.py [--esphome] [--keep DIR] [--language L]

What it does, in this order:
  1. fill.py with house.example.yaml, tests/house.minimal.yaml, tests/house.no-tariff.yaml (the phase-4 modules
     without a tariff module), tests/house.no-entities.yaml (no entities: section) and a variant of the example with EVERY module
     (including modules/_template/) and the optional switches flipped (check_variant: in each module.yaml), once per
     language (en and nl, so both sets of strings.yaml texts are filled in and validated); each into its own build
     folder. When several modules provide the same capability (provides:), the all-modules house keeps the first and
     one extra house per other provider swaps it in (language en)
  2. fill.py with tests/house.broken.yaml must FAIL (a dependency that is not in modules:); the article before car
     names (cars[].article, fill.car_called) gives the expected sentences
  3. every .yaml of every build parses (Home Assistant and ESPHome tags allowed)
  4. every Home Assistant template in that YAML, and every custom_templates/*.jinja, compiles with Jinja2 (HA filters
     and tests stubbed, so a typo in a filter name fails)
  4b. the macro targets() of doorbell/custom_templates/doorbell.jinja ("who gets a notification") runs on the builds
     with stubbed states(), is_state() and now(): every case of tests/doorbell-targets.yaml gives the expected people
  5. every .py of the kit's tools and of every build compiles (Python's compile())
  6. every <module>/deploy.py --dry-run (and --dry-run --setup where the script has --setup) exits 0 without a
     connection (HA_URL and HA_TOKEN are removed from the environment)
  7. fill.py --list and choose.py --answers on a copy of the example (non-interactive): tests/choose.answers.yaml
     must give EXPECTED_CHOICE, tests/choose.no-brands.answers.yaml (no supported brand or region) EXPECTED_CHOICE_NO_BRANDS
     (the modules that need a missing capability are dropped, no provider is added)
  8. with --esphome: `esphome config` on every ESPHome device file of the builds, with dummy secrets
     (uvx esphome==<pins.esphome_tested from module.yaml>; or the command in $ESPHOME_CMD)
  9. tools/scan.py on the kit (fixed patterns; the denylist when it is required, see scan.py)
--keep DIR keeps the build folders in DIR (default: a temporary folder that is removed).
--language L fills the all-modules variant only in language L (en or nl), e.g. for a quick local run.
"""
from __future__ import annotations

import base64
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import jinja2
import yaml
from jinja2 import nodes

KIT = Path(__file__).resolve().parent.parent
TOOLS = KIT / "tools"
MODULES = KIT / "modules"
PY = sys.executable
LANGUAGES = ["en", "nl"]
EXPECTED_CHOICE = ["base", "tesla-route", "gate", "doorbell", "presence", "shading", "notifications",
                   "tesla-driveway-lock", "ventilation-zehnder", "tariff-be", "energy-plan", "energy", "charger-zappi",
                   "ev-charging", "heat-pump-vaillant", "hot-water", "climate", "appliances-home-connect", "results",
                   "home-screen", "e-ink-display"]
EXPECTED_CHOICE_NO_BRANDS = ["base", "tesla-route", "gate", "doorbell", "presence", "shading", "notifications",
                             "tesla-driveway-lock", "ventilation-zehnder", "energy-plan", "energy", "climate",
                             "home-screen", "e-ink-display"]
CHOOSE_CASES = [("choose.answers.yaml", EXPECTED_CHOICE), ("choose.no-brands.answers.yaml", EXPECTED_CHOICE_NO_BRANDS)]

failures: list[str] = []


def step(title: str) -> None:
    print(f"\n== {title}")


def fail(msg: str) -> None:
    failures.append(msg)
    print("  FAIL", msg)


def run(cmd: list[str], cwd: Path | None = None, env: dict | None = None, timeout: int = 900):
    return subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)


class TagLoader(yaml.SafeLoader):
    """Safe loader that accepts every tag (!include, !secret, !lambda, !extend, ...) and keeps the plain value."""


def _any_tag(loader, suffix, node):
    if isinstance(node, yaml.ScalarNode):
        return loader.construct_scalar(node)
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node, deep=True)
    return loader.construct_mapping(node, deep=True)


TagLoader.add_multi_constructor("!", _any_tag)


def strings(o, path=""):
    """(path, string) for every string leaf of parsed YAML."""
    if isinstance(o, dict):
        for k, v in o.items():
            yield from strings(v, f"{path}.{k}")
    elif isinstance(o, list):
        for i, v in enumerate(o):
            yield from strings(v, f"{path}[{i}]")
    elif isinstance(o, str):
        yield path, o


# Home Assistant's own filters and tests (on top of Jinja's). Stubs: only the names matter for compiling.
HA_FILTERS = """
acos as_datetime as_local as_timedelta as_timestamp asin atan atan2 average base64_decode base64_encode bitwise_and
bitwise_or bitwise_xor bool closest combine contains cos device_attr device_id distance expand flatten float
from_hex from_json has_value iif int is_defined is_number log md5 median multiply ord pack random regex_findall
regex_findall_index regex_match regex_replace regex_search relative_time sha1 sha256 sha512 shuffle sin slugify
sqrt state_attr state_translated states statistical_mode tan time_since time_until timestamp_custom timestamp_local
timestamp_utc to_json typeof unpack urlencode version area_id area_name floor_id floor_name label_id label_name
""".split()
HA_TESTS = """
contains datetime has_value is_state is_state_attr is_number list match search set string_like tuple boolean
is_device_attr is_hidden_entity apply
""".split()


def ha_env() -> jinja2.Environment:
    env = jinja2.Environment(extensions=["jinja2.ext.loopcontrols", "jinja2.ext.do"])
    for name in HA_FILTERS:
        env.filters.setdefault(name, lambda *a, **k: None)
    for name in HA_TESTS:
        env.tests.setdefault(name, lambda *a, **k: True)
    return env


def compile_ha(env: jinja2.Environment, source: str) -> str | None:
    """None when the template compiles and every filter and test name exists (also inside {% if %}, where Jinja
    itself only complains at runtime); otherwise the reason."""
    try:
        tree = env.parse(source)
        env.compile(source)
    except jinja2.TemplateError as e:
        return f"{e.__class__.__name__}: {e}"
    unknown = sorted({f"filter {n.name}" for n in tree.find_all(nodes.Filter) if n.name not in env.filters}
                     | {f"test {n.name}" for n in tree.find_all(nodes.Test) if n.name not in env.tests})
    return f"unknown {', '.join(unknown)}" if unknown else None


def fill(house: Path, out: Path) -> bool:
    r = run([PY, str(TOOLS / "fill.py"), str(house), str(out)])
    if r.returncode != 0:
        fail(f"fill.py {house.name}: exit {r.returncode}\n{r.stdout[-3000:]}{r.stderr[-2000:]}")
        return False
    warnings = [line for line in r.stderr.splitlines() if line.startswith("warning:")]
    print(f"  {house.name}: filled in ({sum(1 for _ in out.rglob('*') if _.is_file())} files"
          f"{', ' + str(len(warnings)) + ' translation warnings' if warnings else ''})")
    return True


# (car, language) -> (called, Called): default article, a name with its own article, no article, an own article.
CAR_ARTICLE_CASES = [
    ({"name": "Rode X"}, "nl", ("de Rode X", "De Rode X")),
    ({"name": "Red X"}, "en", ("the Red X", "The Red X")),
    ({"name": "The Blue Comet"}, "nl", ("The Blue Comet", "The Blue Comet")),
    ({"name": "de Kever"}, "en", ("de Kever", "de Kever")),
    ({"name": "Blixem", "article": ""}, "nl", ("Blixem", "Blixem")),
    ({"name": "Busje", "article": "het"}, "nl", ("het Busje", "Het Busje")),
    ({"name": "Rode X"}, "fr", ("Rode X", "Rode X")),
]


def check_car_articles() -> None:
    sys.path.insert(0, str(TOOLS))
    import fill  # noqa: E402

    for car, language, expected in CAR_ARTICLE_CASES:
        got = fill.car_called(car, language)
        if got != expected:
            fail(f"fill.car_called({car}, {language!r}) = {got}, expected {expected}")
    print(f"  car articles: {len(CAR_ARTICLE_CASES)} cases")


def check_yaml_and_templates(builds: list[Path]) -> None:
    env = ha_env()
    n_yaml = n_tpl = 0
    for out in builds:
        for f in sorted(out.rglob("*.yaml")):
            rel = f.relative_to(out)
            try:
                data = yaml.load(f.read_text(encoding="utf-8"), Loader=TagLoader)
            except yaml.YAMLError as e:
                fail(f"{out.name}/{rel}: invalid YAML: {e}")
                continue
            n_yaml += 1
            if "esphome" in rel.parts:
                continue  # ESPHome lambdas are C++, not Jinja
            for path, s in strings(data):
                if "{{" in s or "{%" in s:
                    n_tpl += 1
                    problem = compile_ha(env, s)
                    if problem:
                        fail(f"{out.name}/{rel} {path}: {problem}")
        for f in sorted(out.rglob("custom_templates/*.jinja")):
            n_tpl += 1
            problem = compile_ha(env, f.read_text(encoding="utf-8"))
            if problem:
                fail(f"{out.name}/{f.relative_to(out)}: {problem}")
    print(f"  {n_yaml} YAML files parsed, {n_tpl} Home Assistant templates compiled")


def check_doorbell_targets(builds: list[Path], houses: dict[str, Path]) -> None:
    """Run targets() and names() of the filled-in doorbell.jinja for every case of tests/doorbell-targets.yaml (a case
    whose build is missing, e.g. with --language, is skipped)."""
    cases = yaml.safe_load((KIT / "tests" / "doorbell-targets.yaml").read_text(encoding="utf-8"))["cases"]
    texts = yaml.safe_load((MODULES / "doorbell" / "strings.yaml").read_text(encoding="utf-8"))
    by_name = {out.name.removeprefix("build-"): out for out in builds}
    today = datetime.datetime(2026, 10, 5, 14, 32)
    n = skipped = 0
    for case in cases:
        out = by_name.get(case["build"])
        macros = out / "doorbell" / "custom_templates" if out else None
        if not macros or not (macros / "doorbell.jinja").is_file():
            skipped += 1
            continue
        house = yaml.safe_load(houses[case["build"]].read_text(encoding="utf-8"))
        language = (house.get("house") or {}).get("language") or "en"
        kind = case.get("kind", "ring")
        helper = "ring" if kind == "ring" else "parcel"
        env = jinja2.Environment(loader=jinja2.FileSystemLoader(str(macros)),
                                 extensions=["jinja2.ext.loopcontrols", "jinja2.ext.do"])
        env.filters.update(from_json=json.loads, to_json=json.dumps,
                           regex_findall=lambda v, find="", ignorecase=False: re.findall(find, str(v),
                                                                                         re.I if ignorecase else 0))
        # The imported template keeps the globals it saw first: set the stubs before the first render, fill them after.
        states: dict[str, str] = {}
        env.globals.update(states=lambda e: states.get(e, "unknown"), is_state=lambda e, v: states.get(e) == v,
                           now=lambda: today)
        people = json.loads(env.from_string("{% from 'doorbell.jinja' import candidates %}{{ candidates() }}").render())
        states.update({f"input_select.doorbell_{key}_{helper}": texts.get(f"option_{choice}", {}).get(language, choice)
                       for key, choice in (case.get("choice") or {}).items()})
        states.update({p["person"]: "home" if p["key"] in (case.get("home") or []) else "not_home" for p in people})
        states["input_datetime.parcel_expected"] = str(today.date()) if case.get("parcel_day") else "2000-01-01"
        label = f"tests/doorbell-targets.yaml '{case['name']}' ({case['build']})"
        try:
            got = json.loads(env.from_string("{% from 'doorbell.jinja' import targets %}{{ targets(kind, pressed) }}")
                             .render(kind=kind, pressed=case.get("pressed", "")))
            names = env.from_string("{% from 'doorbell.jinja' import names %}{{ names(got) }}").render(got=got)
        except (jinja2.TemplateError, ValueError, TypeError) as e:
            fail(f"{label}: {e.__class__.__name__}: {e}")
            continue
        n += 1
        notify = {p["key"]: p["notify"] for p in people}
        expected = [notify.get(key, f"(no candidate {key})") for key in case["expect"]]
        if sorted(got) != sorted(expected):
            fail(f"{label}: targets('{kind}') = {got}, expected {expected}")
        expected_names = ", ".join(p["name"] for p in people if p["key"] in case["expect"])
        if names != expected_names:
            fail(f"{label}: names() = {names!r}, expected {expected_names!r}")
    print(f"  doorbell targets: {n} cases" + (f", {skipped} skipped (build not filled in)" if skipped else ""))


def check_python(paths: list[Path]) -> None:
    n = 0
    for f in paths:
        n += 1
        try:
            compile(f.read_text(encoding="utf-8"), str(f), "exec", dont_inherit=True)
        except (SyntaxError, ValueError) as e:
            fail(f"compile {f}: {e}")
    print(f"  {n} Python files compiled")


def check_deploy(builds: list[Path]) -> None:
    env = {k: v for k, v in os.environ.items() if k not in ("HA_URL", "HA_TOKEN")}
    n = 0
    for out in builds:
        for script in sorted(out.glob("*/deploy.py")):
            variants = [["--dry-run"]]
            if "--setup" in script.read_text(encoding="utf-8"):
                variants.append(["--dry-run", "--setup"])
            for args in variants:
                n += 1
                r = run([PY, str(script.relative_to(out)), *args], cwd=out, env=env, timeout=120)
                if r.returncode != 0:
                    fail(f"{out.name}/{script.relative_to(out)} {' '.join(args)}: exit {r.returncode}\n"
                         f"{(r.stdout + r.stderr)[-1500:]}")
    print(f"  {n} dry runs")


def check_choose(tmp: Path) -> None:
    r = run([PY, str(TOOLS / "fill.py"), "--list"])
    if r.returncode != 0 or "base" not in r.stdout:
        fail(f"fill.py --list: exit {r.returncode}\n{r.stdout[-1000:]}{r.stderr[-1000:]}")
    for answers, expected in CHOOSE_CASES:
        house = tmp / f"choose-house-{answers}"
        shutil.copy2(KIT / "house.example.yaml", house)
        before = yaml.safe_load(house.read_text(encoding="utf-8"))
        r = run([PY, str(TOOLS / "choose.py"), "--answers", str(KIT / "tests" / answers), "--house", str(house)])
        if r.returncode != 0:
            fail(f"choose.py --answers {answers}: exit {r.returncode}\n{r.stdout[-1500:]}{r.stderr[-1500:]}")
            continue
        after = yaml.safe_load(house.read_text(encoding="utf-8"))
        if after.get("modules") != expected:
            fail(f"choose.py {answers}: modules {after.get('modules')} != expected {expected}")
        rest_before = {k: v for k, v in before.items() if k != "modules"}
        rest_after = {k: v for k, v in after.items() if k != "modules"}
        if rest_before != rest_after:
            fail(f"choose.py {answers} changed more than modules: in house.yaml")
        if house.read_text(encoding="utf-8").count("#") < 50:
            fail(f"choose.py {answers} lost the comments of house.yaml")
        print(f"  choose.py {answers} -> {', '.join(after.get('modules') or [])}")
    print("  fill.py --list ok")


def esphome_devices(out: Path) -> list[Path]:
    """ESPHome device files: YAML under an esphome/ folder with esphome: or packages: on top, not included by another."""
    files = [f for f in out.rglob("*.yaml") if "esphome" in f.relative_to(out).parts]
    texts = {f: f.read_text(encoding="utf-8") for f in files}
    devices = []
    for f in files:
        if any(f.name in t for g, t in texts.items() if g != f and g.parent == f.parent):
            continue
        data = yaml.load(texts[f], Loader=TagLoader) or {}
        if isinstance(data, dict) and ("esphome" in data or "packages" in data):
            devices.append(f)
    return sorted(devices)


def esphome_version() -> str:
    versions = set()
    for meta in MODULES.glob("*/module.yaml"):
        pin = ((yaml.safe_load(meta.read_text(encoding="utf-8")) or {}).get("pins") or {}).get("esphome_tested")
        if pin:
            versions.add(str(pin))
    if len(versions) != 1:
        fail(f"modules disagree on pins.esphome_tested: {sorted(versions)}")
    return sorted(versions)[-1] if versions else "2026.9.0"


def check_esphome(builds: list[Path]) -> None:
    cmd = os.environ.get("ESPHOME_CMD")
    command = cmd.split() if cmd else ["uvx", f"esphome=={esphome_version()}"]
    if not cmd and not shutil.which("uvx"):
        fail("--esphome: uvx not found (install uv, or set ESPHOME_CMD)")
        return
    seen: dict[str, Path] = {}
    for out in builds:
        for dev in esphome_devices(out):
            key = dev.read_text(encoding="utf-8")
            if key in seen:
                continue
            seen[key] = dev
            meta = yaml.safe_load((dev.parents[1] / "module.yaml").read_text(encoding="utf-8")) or {}
            secrets = {}
            # secrets: plus every optional list (secrets_<switch>:, e.g. secrets_web_server) gets a dummy value
            names = [n for key, value in meta.items() if key.startswith("secrets") for n in (value or [])]
            for name in names:
                if name.endswith("encryption_key"):
                    secrets[name] = base64.b64encode(bytes(range(1, 33))).decode()  # dummy, check only
                else:
                    secrets[name] = "ha-kit-check-only"
            (dev.parent / "secrets.yaml").write_text(yaml.safe_dump(secrets), encoding="utf-8")
            r = run([*command, "config", dev.name], cwd=dev.parent, timeout=1200)
            label = f"{out.name}/{dev.relative_to(out)}"
            if r.returncode != 0 or "Configuration is valid" not in r.stdout + r.stderr:
                fail(f"esphome config {label}: exit {r.returncode}\n{(r.stdout + r.stderr)[-2500:]}")
            else:
                print(f"  esphome config {label}: valid")
    print(f"  {len(seen)} ESPHome device files ({' '.join(command)})")


def all_modules_house(example: dict) -> tuple[dict, dict[str, list[str]]]:
    """The example house with every module, plus the other side of every optional switch (check_variant: in
    module.yaml, {section: {key: value}}), so both branches are filled in, compiled and (ESPHome) validated.
    Returns (house, {name: modules}) where the second item lists extra module sets for alternate capability providers."""
    everything = dict(example)
    metas = {}
    for path in sorted(MODULES.glob("*/module.yaml")):
        metas[path.parent.name] = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    for slug, meta in metas.items():
        for section, values in (meta.get("check_variant") or {}).items():
            if not isinstance(values, dict):
                fail(f"modules/{slug}/module.yaml: check_variant.{section} must be a mapping key -> value")
                continue
            everything[section] = {**(everything.get(section) or {}), **values}
    providers: dict[str, list[str]] = {}
    for slug, meta in metas.items():
        for cap in meta.get("provides") or []:
            providers.setdefault(str(cap), []).append(slug)
    skip = {slug for slugs in providers.values() for slug in slugs[1:]}
    everything["modules"] = [slug for slug in metas if slug not in skip]
    alternates = {}
    for cap, slugs in providers.items():
        for other in slugs[1:]:
            alternates[f"all-modules-{other}"] = [other if m == slugs[0] else m for m in everything["modules"]]
    return everything, alternates


def main() -> None:
    args = sys.argv[1:]
    with_esphome = "--esphome" in args
    keep = Path(args[args.index("--keep") + 1]).resolve() if "--keep" in args else None
    languages = [args[args.index("--language") + 1]] if "--language" in args else LANGUAGES
    unknown = [a for a in args if a.startswith("-") and a not in ("--esphome", "--keep", "--language")]
    if unknown or any(lang not in LANGUAGES for lang in languages):
        sys.exit(__doc__)
    tmp = keep or Path(tempfile.mkdtemp(prefix="ha-kit-check-"))
    if keep:
        shutil.rmtree(keep, ignore_errors=True)
        keep.mkdir(parents=True)
    try:
        step("1. fill in")
        example = yaml.safe_load((KIT / "house.example.yaml").read_text(encoding="utf-8"))
        everything, alternates = all_modules_house(example)
        houses = {"example": KIT / "house.example.yaml", "minimal": KIT / "tests" / "house.minimal.yaml",
                  "no-tariff": KIT / "tests" / "house.no-tariff.yaml",
                  "no-entities": KIT / "tests" / "house.no-entities.yaml"}
        for lang in languages:
            everything["house"] = {**example["house"], "language": lang}
            all_house = tmp / f"house.all-modules-{lang}.yaml"
            all_house.write_text(yaml.safe_dump(everything, allow_unicode=True, sort_keys=False), encoding="utf-8")
            houses[f"all-modules-{lang}"] = all_house
        for name, mods in alternates.items():
            alt = {**everything, "modules": mods, "house": {**example["house"], "language": "en"}}
            alt_house = tmp / f"house.{name}.yaml"
            alt_house.write_text(yaml.safe_dump(alt, allow_unicode=True, sort_keys=False), encoding="utf-8")
            houses[name] = alt_house
        builds = []
        for name, house in houses.items():
            out = tmp / f"build-{name}"
            if fill(house, out):
                builds.append(out)

        step("2. a broken house must fail")
        r = run([PY, str(TOOLS / "fill.py"), str(KIT / "tests" / "house.broken.yaml"), str(tmp / "build-broken")])
        if r.returncode == 0:
            fail("fill.py tests/house.broken.yaml succeeded, expected an error")
        else:
            print("  stopped as expected:", (r.stdout + r.stderr).strip().splitlines()[-1][:120])
        check_car_articles()

        step("3+4. YAML and Home Assistant templates")
        check_yaml_and_templates(builds)

        step("4b. doorbell: who gets a notification")
        check_doorbell_targets(builds, houses)

        step("5. Python")
        py = sorted(TOOLS.glob("*.py")) + [f for out in builds for f in sorted(out.rglob("*.py"))]
        check_python(py)

        step("6. deploy.py --dry-run")
        check_deploy(builds)

        step("7. fill.py --list and choose.py")
        check_choose(tmp)

        if with_esphome:
            step("8. esphome config")
            check_esphome(builds)
        else:
            step("8. esphome config: skipped (use --esphome)")

        step("9. scan")
        r = run([PY, str(TOOLS / "scan.py")], cwd=KIT)
        print("  " + (r.stdout.strip().splitlines() or ["?"])[-1])
        if r.returncode != 0:
            fail(f"scan.py: exit {r.returncode}\n{r.stdout[-2000:]}{r.stderr[-1000:]}")
    finally:
        if not keep:
            shutil.rmtree(tmp, ignore_errors=True)

    print()
    if failures:
        print(f"check FAILED: {len(failures)} problem(s)")
        sys.exit(1)
    print("check passed")


if __name__ == "__main__":
    main()
