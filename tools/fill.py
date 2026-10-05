"""Fill in the chosen modules of the kit for one house and write the result to a target folder.

  cp house.example.yaml house.yaml        # then edit house.yaml (it stays local, see .gitignore)
  uv run --with-requirements tools/requirements.txt python tools/fill.py house.yaml build/
  uv run --with-requirements tools/requirements.txt python tools/fill.py --list

Every text file of every module in `modules:` (plus 'base', always) is rendered with Jinja2 using its own
delimiters, so Home Assistant templates with {{ }} and {% %} pass through untouched:
  <@ car.name @>             variable
  <% for car in cars %>      block
  <# note #>                 comment
The context is the whole house.yaml plus `module` (the parsed module.yaml) and `capabilities` (sorted list of what the
chosen modules declare under provides:, e.g. ['ev-charger', 'tariff']). Undefined values are an error.
depends_on may name a module or a capability: 'tariff' is met by any chosen module with provides: [tariff] (a region
module such as tariff-be). At most one chosen module may provide each capability.
Module folders whose name starts with '_' (e.g. modules/_template/) are skipped unless house.yaml lists them.
Partials: files named _<name>.jinja in the module folder or in tools/partials/ can be imported or included,
  <% from '_presence.jinja' import places, school with context %>   (names set at the top of the partial)
  <% include '_note.jinja' %>                                        (text)
and are never copied to the target folder themselves. The module folder is searched first, then tools/partials/.
Filters on top of Jinja's own: regex_replace(find, replace, ignorecase=False), regex_search(find, ignorecase=False)
(Python re, same signatures as in Home Assistant), shell_quote (shlex.quote: one shell word).
Global functions for the modules:
  <@ car_entity(car, 'location') @>  entity_id of a car for a role: cars[].entities.<role> when set, otherwise the
                                     pattern teslemetry.<role> from house.yaml with {p} = car.prefix
  <@ fail('reason') @>               stop with a clear error (module + file + line), e.g. inside <% if not cars %>
  <@ safe_name(v.name, 'ventilation.name') @>  the value, or stop unless it matches ^[a-z0-9][a-z0-9_-]*$: use it
                                     for every house.yaml value that becomes part of a file path or device name
  <@ safe_entity(eid, 'entities.x') @>  the value, or stop unless it is an entity id (domain.object_id): for entity
                                     ids inside a shell command or a quoted Home Assistant template string
Escaping (house.yaml values are data, never code): in JavaScript and Python write <@ value | tojson @> (numbers:
<@ value | float | tojson @>); in a shell command (command_line) <@ value | shell_quote @>.
  <@ t('key', name=person.name) @>   user-facing text from the module's strings.yaml in house.language (default en);
                                     {name} in the text is replaced by the keyword argument. A missing language falls
                                     back to en with a warning; a missing key is an error.
`generate:` in module.yaml renders one source file once per item of a list (e.g. per room), with `item` set;
an optional `if:` (a Jinja expression with `item`, e.g. item.sensor) skips the items for which it is false.
Binary files are copied. tools/ha_api.py and tools/requirements.txt (pinned dependencies) are copied to the root of
the target folder for the deploy scripts.
Every key in a module.yaml and strings.yaml (and every text in strings.yaml) must be a string: YAML 1.1 reads an
unquoted no/off/yes/on as a boolean and 1 as a number, so fill.py stops with file and line; quote it ("off": ...).
Afterwards the target folder is checked for leftovers (<@, <%, old <PLACEHOLDERS>): exit 1 if any.
"""
from __future__ import annotations

import re
import shlex
import shutil
import sys
from pathlib import Path

import yaml
from jinja2 import (
    Environment,
    FileSystemLoader,
    StrictUndefined,
    TemplateError,
    TemplateNotFound,
    TemplateSyntaxError,
    pass_context,
)
from jinja2.runtime import Context

KIT = Path(__file__).resolve().parent.parent
MODULES = KIT / "modules"
TOOLS = KIT / "tools"
# Shared Jinja partials for every module (the module's own folder is searched first).
PARTIALS = TOOLS / "partials"
ALWAYS = "base"
MARKER = ".ha-kit-build"
DEFAULT_LANGUAGE = "en"
BINARY = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".stl", ".3mf", ".fzz", ".svg", ".pdf", ".zip"}
# house.fragment.yaml: a module's example fields for house.yaml while it is being built (merged into
# house.example.yaml when the module is integrated); strings.yaml: read by t(); HOUSE-CHANGES.md: notes of a module
# for whoever integrates it (changes outside the module folder). None of them is part of the output.
SKIP_NAMES = {".DS_Store", "house.fragment.yaml", "strings.yaml", "HOUSE-CHANGES.md"}
SKIP_DIRS = {"__pycache__", ".git"}
LEFTOVER = re.compile(r"<@|<%|<[A-Z][A-Z0-9_]+>")
YAML_STR = "tag:yaml.org,2002:str"
PLACEHOLDER = re.compile(r"\{(\w+)\}")


class KitError(Exception):
    """Raised by fail() in a module template: the house file does not fit the module."""


@pass_context
def fail(ctx: Context, msg: str) -> str:
    raise KitError(msg)


SAFE_NAME = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
SAFE_ENTITY = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")


def safe_name(value, field: str = "name") -> str:
    """`value` when it is safe as a file or device name (lower case letters, digits, '-' and '_', no leading '-' or
    '_', so no '/', '..' or spaces); otherwise fill.py stops naming the house.yaml field. Use it for every value that
    ends up in a file path (e.g. /config/esphome/<name>.yaml)."""
    text = "" if value is None else str(value)
    if not SAFE_NAME.match(text):
        raise KitError(f"house.yaml: {field} {text!r} may only contain lower case letters, digits, '-' and '_' "
                       f"(starting with a letter or digit), e.g. my-device")
    return text


def safe_entity(value, field: str = "entity") -> str:
    """`value` when it looks like an entity id (domain.object_id, lower case, digits, '_'); otherwise fill.py stops.
    Use it for entity ids that end up in a shell command or inside a quoted Home Assistant template string."""
    text = "" if value is None else str(value)
    if not SAFE_ENTITY.match(text):
        raise KitError(f"house.yaml: {field} {text!r} is not an entity id (e.g. sensor.indoor_temperature)")
    return text


def shell_quote(value) -> str:
    """Filter: the value as one shell word (shlex.quote; unchanged when it only has safe characters)."""
    return shlex.quote("" if value is None else str(value))


@pass_context
def car_entity(ctx: Context, car: dict, role: str) -> str:
    """entity_id of car `car` for role `role`: cars[].entities.<role>, else teslemetry.<role> with {p} = prefix."""
    override = (car.get("entities") or {}).get(role)
    if override:
        return str(override)
    prefix = car.get("prefix")
    if not prefix:
        raise KitError(f"car '{car.get('name', '?')}' has no prefix in house.yaml")
    patterns = ctx.get("teslemetry")
    if not isinstance(patterns, dict):
        raise KitError("house.yaml has no section teslemetry: (entity pattern per role, see house.example.yaml)")
    if not patterns.get(role):
        raise KitError(f"house.yaml: teslemetry.{role} is missing (or set cars[].entities.{role} for {prefix})")
    return str(patterns[role]).replace("{p}", str(prefix))


class Strings:
    """The texts of one module (strings.yaml: {key: {en: ..., nl: ...}}) for one language, used by t()."""

    def __init__(self, slug: str, language: str, warnings: set[str]) -> None:
        self.slug, self.language, self.warnings = slug, language, warnings
        path = MODULES / slug / "strings.yaml"
        label = str(path.relative_to(KIT))
        self.table = (load_yaml(path, label, texts_depth=2) or {}) if path.is_file() else {}
        if not isinstance(self.table, dict):
            sys.exit(f"{label}: expected a mapping key -> {{en: ..., nl: ...}} at the top")
        for key, texts in self.table.items():
            if not isinstance(texts, dict) or not isinstance(texts.get(DEFAULT_LANGUAGE), str):
                sys.exit(f"{label}: '{key}' needs at least an '{DEFAULT_LANGUAGE}' text")

    def __call__(self, key: str, **kwargs) -> str:
        texts = self.table.get(key)
        if texts is None:
            where = f"modules/{self.slug}/strings.yaml" if self.table else f"modules/{self.slug} (no strings.yaml)"
            raise KitError(f"t('{key}'): key missing in {where}")
        text = texts.get(self.language)
        if not isinstance(text, str):
            self.warnings.add(f"modules/{self.slug}/strings.yaml: '{key}' has no '{self.language}' text, "
                              f"used '{DEFAULT_LANGUAGE}'")
            text = texts[DEFAULT_LANGUAGE]
        unknown = [k for k in kwargs if f"{{{k}}}" not in text]
        if unknown:
            raise KitError(f"t('{key}'): the text has no placeholder for {', '.join(unknown)}")
        return PLACEHOLDER.sub(lambda m: str(kwargs[m.group(1)]) if m.group(1) in kwargs else m.group(0), text)


def is_partial(path: Path) -> bool:
    """A shared Jinja partial (_<name>.jinja): importable by the module's templates, never copied itself."""
    return path.name.startswith("_") and path.name.endswith(".jinja")


class PartialLoader(FileSystemLoader):
    """Loads only partials (_<name>.jinja), so a template cannot pull in another module file by accident."""

    def get_source(self, environment: Environment, template: str):
        if not is_partial(Path(template)):
            raise TemplateNotFound(f"{template} (only partials _<name>.jinja can be imported)")
        return super().get_source(environment, template)


def regex_replace(value="", find="", replace="", ignorecase=False) -> str:
    """Like Home Assistant's regex_replace: re.sub on the string value."""
    return re.sub(find, replace, str(value), flags=re.IGNORECASE if ignorecase else 0)


def regex_search(value="", find="", ignorecase=False) -> bool:
    """Like Home Assistant's regex_search: True when the pattern occurs anywhere in the string value."""
    return re.search(find, str(value), flags=re.IGNORECASE if ignorecase else 0) is not None


def house_language(house: dict) -> str:
    section = house.get("house") if isinstance(house.get("house"), dict) else {}
    return str(section.get("language") or DEFAULT_LANGUAGE)


def make_env(module_dir: Path, strings: Strings | None = None) -> Environment:
    """Jinja environment for one module: partials from its own folder first, then from tools/partials/."""
    env = Environment(
        loader=PartialLoader([str(module_dir), str(PARTIALS)]),
        variable_start_string="<@",
        variable_end_string="@>",
        block_start_string="<%",
        block_end_string="%>",
        comment_start_string="<#",
        comment_end_string="#>",
        undefined=StrictUndefined,
        keep_trailing_newline=True,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.globals.update(car_entity=car_entity, fail=fail, safe_name=safe_name, safe_entity=safe_entity)
    if strings is not None:
        env.globals["t"] = strings
    env.filters.update(regex_replace=regex_replace, regex_search=regex_search, shell_quote=shell_quote)
    env.tests.update(regex_search=regex_search)
    return env


def skipped(path: Path, root: Path) -> bool:
    rel = path.relative_to(root)
    return (
        path.name in SKIP_NAMES
        or is_partial(path)
        or ".bak" in path.name
        or any(part in SKIP_DIRS for part in rel.parts)
    )


def _kind(tag: str) -> str:
    return {"tag:yaml.org,2002:bool": "a boolean", "tag:yaml.org,2002:int": "a number",
            "tag:yaml.org,2002:float": "a number", "tag:yaml.org,2002:null": "empty (null)"}.get(tag, tag)


def not_strings(node, label: str, texts_depth: int | None = None, depth: int = 1) -> list[str]:
    """'file:line:col: ...' for every mapping key below `node` that YAML does not read as a string (YAML 1.1: no, off,
    yes, on are booleans, 1 is a number), and with texts_depth for every scalar value at that depth (the texts of
    strings.yaml: {key: {en: text}} has its texts at depth 2)."""
    out: list[str] = []
    if isinstance(node, yaml.MappingNode):
        for key, value in node.value:
            if isinstance(key, yaml.ScalarNode) and key.tag != YAML_STR:
                m = key.start_mark
                out.append(f"{label}:{m.line + 1}:{m.column + 1}: key {key.value!r} is read as {_kind(key.tag)}, "
                           f"not as text: quote it (\"{key.value}\":)")
            if (texts_depth is not None and depth == texts_depth and isinstance(value, yaml.ScalarNode)
                    and value.tag != YAML_STR):
                m = value.start_mark
                out.append(f"{label}:{m.line + 1}:{m.column + 1}: text {value.value!r} is read as {_kind(value.tag)}, "
                           f"not as text: quote it (\"{value.value}\")")
            out += not_strings(value, label, texts_depth, depth + 1)
    elif isinstance(node, yaml.SequenceNode):
        for item in node.value:
            out += not_strings(item, label, texts_depth, depth)
    return out


def load_yaml(path: Path, label: str, strict_keys: bool = False, texts_depth: int | None = None):
    """Parse a YAML file; exits with file and line (no stack trace) when the YAML is invalid. strict_keys (or
    texts_depth): also exits when a key (or a text at that depth) is not a string, see not_strings()."""
    text = path.read_text(encoding="utf-8")
    try:
        if strict_keys or texts_depth is not None:
            problems = not_strings(yaml.compose(text, Loader=yaml.SafeLoader), label, texts_depth)
            if problems:
                sys.exit("\n".join(problems))
        return yaml.safe_load(text)
    except yaml.YAMLError as e:
        mark = getattr(e, "problem_mark", None) or getattr(e, "context_mark", None)
        where = f"{label}:{mark.line + 1}:{mark.column + 1}" if mark else label
        reason = " ".join(str(x) for x in (getattr(e, "context", None), getattr(e, "problem", None)) if x)
        sys.exit(f"{where}: invalid YAML: {reason or e}")


def load_module(slug: str) -> dict:
    """Parsed module.yaml of one module (raw, not rendered); exits when missing or incomplete."""
    path = MODULES / slug / "module.yaml"
    if not path.is_file():
        sys.exit(f"module '{slug}' does not exist (no {path.relative_to(KIT)})")
    meta = load_yaml(path, str(path.relative_to(KIT)), strict_keys=True) or {}
    if not isinstance(meta, dict):
        sys.exit(f"{path.relative_to(KIT)}: expected a YAML mapping at the top")
    for field in ("name", "description"):
        if not meta.get(field):
            sys.exit(f"{path.relative_to(KIT)}: field '{field}' is missing")
    meta.setdefault("status", "-")
    meta.setdefault("depends_on", [])
    meta.setdefault("requires", {})
    meta.setdefault("optional", False)
    meta.setdefault("generate", [])
    meta.setdefault("ask", [])
    meta.setdefault("provides", [])
    meta["slug"] = slug
    return meta


def all_modules(include_private: bool = False) -> list[dict]:
    """Every module of the kit; folders starting with '_' (templates, work in progress) only on request."""
    return [load_module(p.parent.name) for p in sorted(MODULES.glob("*/module.yaml"))
            if include_private or not p.parent.name.startswith("_")]


def show_list() -> None:
    rows = [("module", "description", "depends on", "provides", "integrations", "hardware", "optional", "status")]
    for m in all_modules():
        req = m["requires"] or {}
        rows.append((
            m["slug"],
            m["description"],
            ", ".join(m["depends_on"]) or "-",
            ", ".join(m["provides"]) or "-",
            ", ".join(req.get("integrations") or []) or "-",
            ", ".join(req.get("hardware") or []) or "-",
            "yes" if m["optional"] else "no",
            m["status"],
        ))
    widths = [max(len(str(r[i])) for r in rows) for i in range(len(rows[0]))]
    for n, row in enumerate(rows):
        print("  ".join(str(c).ljust(w) for c, w in zip(row, widths)).rstrip())
        if n == 0:
            print("  ".join("-" * w for w in widths))


def chosen_modules(house: dict) -> list[dict]:
    names = house.get("modules") or []
    if not isinstance(names, list):
        sys.exit("house.yaml: 'modules' must be a list, e.g. modules: [base, gate]")
    names = [ALWAYS] + [n for n in names if n != ALWAYS]
    modules = [load_module(n) for n in dict.fromkeys(names)]
    providers: dict[str, list[str]] = {}
    for m in modules:
        for cap in m["provides"]:
            providers.setdefault(str(cap), []).append(m["slug"])
    errors = [f"capability '{cap}' is provided by {' and '.join(slugs)}: keep only one of them in modules:"
              for cap, slugs in providers.items() if len(slugs) > 1]
    for m in modules:
        for dep in m["depends_on"]:
            if dep in names or dep in providers:
                continue
            offer = [o["slug"] for o in all_modules() if dep in o["provides"]]
            if offer:
                errors.append(f"module '{m['slug']}' needs '{dep}': add a module that provides it to modules: "
                              f"({', '.join(offer)})")
            else:
                errors.append(f"module '{m['slug']}' depends on '{dep}', but that is not in modules:")
    if errors:
        sys.exit("\n".join(errors))
    return modules


def capabilities(modules: list[dict]) -> list[str]:
    """Sorted capabilities (provides:) of the chosen modules; available in every template as `capabilities`."""
    return sorted({str(c) for m in modules for c in m["provides"]})


def check_target(target: Path) -> None:
    if target == KIT or target in KIT.parents:
        sys.exit("choose a target folder inside or next to the kit, not the kit itself or a parent folder")
    for forbidden in (MODULES, TOOLS):
        if target == forbidden or forbidden in target.parents:
            sys.exit(f"the target folder may not be inside {forbidden.relative_to(KIT)}/")
    if target.exists() and any(target.iterdir()) and not (target / MARKER).exists():
        sys.exit(f"{target} is not empty and is no earlier output of fill.py: choose an empty folder")


def template_where(e: BaseException) -> str:
    """':<line>' in the module file where a render error happened (Jinja rewrites the traceback to template lines),
    plus ' (in _<partial>.jinja:<line>)' when it was raised inside a partial."""
    own, partial, tb = None, None, e.__traceback__
    while tb is not None:
        name = tb.tb_frame.f_code.co_filename
        if name == "<template>":
            own = tb.tb_lineno
        elif is_partial(Path(name)):
            partial = f"{Path(name).name}:{tb.tb_lineno}"
        tb = tb.tb_next
    return (f":{own}" if own else "") + (f" (in {partial})" if partial else "")


def render(env: Environment, text: str, context: dict, label: str, errors: list[str]) -> str | None:
    try:
        return env.from_string(text).render(**context)
    except TemplateSyntaxError as e:
        errors.append(f"{label}:{e.lineno}: syntax error: {e.message}")
    except KitError as e:
        errors.append(f"{label}{template_where(e)}: {e}")
    except TemplateError as e:
        errors.append(f"{label}{template_where(e)}: {e.__class__.__name__}: {e}")
    return None


def condition(env: Environment, expr, context: dict, label: str, errors: list[str]) -> bool | None:
    """Value of a Jinja expression (generate `if:`) as a bool; an undefined result counts as false. None on error."""
    try:
        return bool(env.compile_expression(str(expr), undefined_to_none=True)(**context))
    except KitError as e:
        errors.append(f"{label}: {e}")
    except TemplateError as e:
        errors.append(f"{label}: {e.__class__.__name__}: {e}")
    return None


def fill_module(env: Environment, house: dict, meta: dict, target: Path, errors: list[str],
                caps: list[str] | None = None) -> list[Path]:
    src_root = MODULES / meta["slug"]
    dst_root = target / meta["slug"]
    if dst_root.exists():
        shutil.rmtree(dst_root)
    context = {**house, "module": meta, "capabilities": caps or []}
    written: list[Path] = []
    gen_sources = {(src_root / g["source"]).resolve() for g in meta["generate"] if g.get("source")}

    for src in sorted(src_root.rglob("*")):
        if src.is_dir() or skipped(src, src_root) or src.resolve() in gen_sources:
            continue
        rel = src.relative_to(src_root)
        dst = dst_root / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if src.suffix.lower() in BINARY:
            shutil.copy2(src, dst)
            continue
        try:
            text = src.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            shutil.copy2(src, dst)
            continue
        protected: dict[str, str] = {}
        if rel == Path("module.yaml"):
            # generate.name is itself a per-item template (needs `item`): keep it out of this render and show it
            # in the output as {item.slug} so no <@ markers are left behind.
            for i, g in enumerate(meta["generate"]):
                if g.get("name") and g["name"] in text:
                    token = f"__HA_KIT_GENERATE_NAME_{i}__"
                    text = text.replace(g["name"], token)
                    protected[token] = re.sub(r"<@\s*(.*?)\s*@>", r"{\1}", g["name"])
        out = render(env, text, context, f"modules/{meta['slug']}/{rel}", errors)
        for token, shown in protected.items():
            out = out.replace(token, shown) if out is not None else None
        if out is not None:
            dst.write_text(out, encoding="utf-8")
            shutil.copymode(src, dst)
            written.append(dst)

    for g in meta["generate"]:
        for field in ("source", "per", "name"):
            if not g.get(field):
                errors.append(f"modules/{meta['slug']}/module.yaml: generate is missing '{field}'")
                break
        else:
            src = src_root / g["source"]
            items = context.get(g["per"])
            if not src.is_file():
                errors.append(f"modules/{meta['slug']}/module.yaml: generate source {g['source']} does not exist")
                continue
            if not isinstance(items, list):
                errors.append(f"modules/{meta['slug']}: generate per '{g['per']}' is not a list in house.yaml")
                continue
            text = src.read_text(encoding="utf-8")
            for item in items:
                item_ctx = {**context, "item": item}
                if g.get("if") is not None:
                    keep = condition(env, g["if"], item_ctx, f"modules/{meta['slug']}/module.yaml (if)", errors)
                    if not keep:
                        continue
                name = render(env, g["name"], item_ctx, f"modules/{meta['slug']}/module.yaml (name)", errors)
                out = render(env, text, item_ctx, f"modules/{meta['slug']}/{g['source']}", errors)
                if name is None or out is None:
                    continue
                dst = (dst_root / name).resolve()
                if dst_root.resolve() not in dst.parents:
                    errors.append(f"modules/{meta['slug']}: generate path '{name}' lies outside the module")
                    continue
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_text(out, encoding="utf-8")
                written.append(dst)
    return written


def leftovers(files: list[Path], target: Path) -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}
    for f in files:
        for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            for m in LEFTOVER.finditer(line):
                found.setdefault(str(f.relative_to(target)), []).append(f"line {n}: {m.group(0)}")
    return found


def main() -> None:
    args = sys.argv[1:]
    if args == ["--list"]:
        show_list()
        return
    if len(args) != 2 or any(a.startswith("-") for a in args):
        sys.exit(__doc__)
    if not Path(args[0]).is_file():
        sys.exit(f"{args[0]} does not exist (cp house.example.yaml house.yaml)")
    house = load_yaml(Path(args[0]), args[0]) or {}
    if not isinstance(house, dict):
        sys.exit(f"{args[0]}: expected a YAML mapping at the top")
    target = Path(args[1]).resolve()
    check_target(target)
    modules = chosen_modules(house)
    language = house_language(house)

    target.mkdir(parents=True, exist_ok=True)
    (target / MARKER).write_text("Output of ha-kit tools/fill.py; safe to delete and regenerate.\n")
    shutil.copy2(TOOLS / "ha_api.py", target / "ha_api.py")
    # Pinned (hashed) Python dependencies, for: uv run --with-requirements requirements.txt python <module>/deploy.py
    shutil.copy2(TOOLS / "requirements.txt", target / "requirements.txt")

    errors: list[str] = []
    warnings: set[str] = set()
    written: list[Path] = []
    caps = capabilities(modules)
    for meta in modules:
        strings = Strings(meta["slug"], language, warnings)
        files = fill_module(make_env(MODULES / meta["slug"], strings), house, meta, target, errors, caps)
        written += files
        print(f"  {meta['slug']}: {len(files)} files")
    for w in sorted(warnings):
        print("warning:", w, file=sys.stderr)
    if errors:
        print("ERRORS WHILE FILLING IN:")
        for e in errors:
            print("  " + e)
        sys.exit(1)

    print("filled in to", target)
    left = leftovers(written, target)
    if left:
        print("NOT FILLED IN YET:")
        for f, hits in sorted(left.items()):
            print(f"  {f}: {', '.join(hits)}")
        sys.exit(1)
    print("no placeholder leftovers")


if __name__ == "__main__":
    main()
