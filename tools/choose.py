"""Choose your modules by answering what hardware you have; writes `modules:` in house.yaml.

  uv run --with-requirements tools/requirements.txt python tools/choose.py                         # interactive, updates house.yaml
  uv run --with-requirements tools/requirements.txt python tools/choose.py --answers answers.yaml  # non-interactive
  options: --house PATH (default house.yaml; created from house.example.yaml when missing), --print (only print the
           modules: block, change nothing)

The questions come from module.yaml:
  ask:                                   # every question must get the answer the module needs
    - id: gate                           # questions with the same id (in several modules) are asked once
      question: Do you have an electric gate ...?
    - id: ventilation                    # a choice between brands: options + need
      question: Which ventilation unit do you have?
      options: [Zehnder ComfoAir Q, other, none]
      need: Zehnder ComfoAir Q
A module without ask: gets one yes/no question built from its name, description and requires.hardware.
'base' is always included; modules in folders starting with '_' and modules with status 'skeleton' (contract only,
nothing to install yet) are never offered. Dependencies (depends_on) on a module are added with a note. A dependency
on a capability (provides: in module.yaml, e.g. tariff, ev-charger) is never added for you, because the brand or
region is your choice: when none of the chosen modules provides it, the module that needs it is dropped with a note. The answers file maps question id -> answer (yes/no, or one of the options):
  tesla: yes
  ventilation: Zehnder ComfoAir Q
Only the modules: block of house.yaml is replaced; the rest of the file, comments included, stays as it is. When
that is not possible safely, the block is printed for you to paste.
"""
from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path

import yaml

KIT = Path(__file__).resolve().parent.parent
MODULES = KIT / "modules"
EXAMPLE = KIT / "house.example.yaml"
ALWAYS = "base"
YES = {"yes", "y", "true", "ja", "j", "1"}
NO = {"no", "n", "false", "nee", "0"}


def load_modules() -> dict[str, dict]:
    out = {}
    for path in sorted(MODULES.glob("*/module.yaml")):
        slug = path.parent.name
        if slug.startswith("_"):
            continue
        meta = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        if str(meta.get("status", "")).startswith("skeleton"):
            continue
        meta["slug"] = slug
        out[slug] = meta
    return out


def questions_of(meta: dict) -> list[dict]:
    asks = meta.get("ask") or []
    if asks:
        return asks
    hardware = ", ".join((meta.get("requires") or {}).get("hardware") or [])
    text = f"Install {meta.get('name', meta['slug'])}: {meta.get('description', '')}?"
    if hardware:
        text += f" (needs: {hardware})"
    return [{"id": meta["slug"], "question": text}]


def normalise(value, options: list[str] | None) -> str | None:
    """'yes'/'no' for a yes/no question, the option as written in module.yaml for a choice; None when invalid."""
    text = str(value).strip() if value is not None else ""
    if isinstance(value, bool):
        text = "yes" if value else "no"
    if options:
        if text.isdigit() and 1 <= int(text) <= len(options):
            return options[int(text) - 1]
        for o in options:
            if o.lower() == text.lower():
                return o
        return None
    low = text.lower()
    return "yes" if low in YES else "no" if low in NO else None


class Asker:
    def __init__(self, answers: dict | None) -> None:
        self.answers = answers
        self.cache: dict[str, str] = {}
        self.options: dict[str, list[str]] = {}

    def collect_options(self, modules: dict[str, dict]) -> None:
        """Merge the options of questions that share an id (one per brand adapter), 'other'/'none' last."""
        for meta in modules.values():
            for q in questions_of(meta):
                if q.get("options"):
                    merged = self.options.setdefault(q["id"], [])
                    for o in q["options"]:
                        if o not in merged:
                            merged.append(o)
        for qid, opts in self.options.items():
            tail = [o for o in opts if o.lower() in ("other", "none")]
            self.options[qid] = [o for o in opts if o not in tail] + tail

    def ask(self, q: dict, hint: str) -> str:
        qid = q["id"]
        if qid in self.cache:
            return self.cache[qid]
        options = self.options.get(qid)
        if self.answers is not None:
            if qid not in self.answers:
                sys.exit(f"answers file: no answer for '{qid}': {q['question']}"
                         + (f" (one of: {', '.join(options)})" if options else " (yes/no)"))
            answer = normalise(self.answers[qid], options)
            if answer is None:
                sys.exit(f"answers file: '{qid}: {self.answers[qid]}' is not valid"
                         + (f" (one of: {', '.join(options)})" if options else " (yes/no)"))
        else:
            while True:
                print(f"\n{q['question']}" + (f"\n  ({hint})" if hint else ""))
                if options:
                    for i, o in enumerate(options, 1):
                        print(f"  {i}. {o}")
                    raw = input("  number or text: ")
                else:
                    raw = input("  [y/n]: ")
                answer = normalise(raw, options)
                if answer is not None:
                    break
                print("  not understood, try again")
        self.cache[qid] = answer
        return answer


def example_order() -> list[str]:
    try:
        return list((yaml.safe_load(EXAMPLE.read_text(encoding="utf-8")) or {}).get("modules") or [])
    except (OSError, yaml.YAMLError):
        return []


def providers_of(cap: str, among, modules: dict[str, dict]) -> list[str]:
    """Modules in `among` whose provides: lists capability `cap`."""
    return [m for m in sorted(among) if cap in (modules.get(m, {}).get("provides") or [])]


def needs(m: str, chosen, modules: dict[str, dict]) -> list[str]:
    """The chosen modules `m` must come after: its module dependencies and the providers of its capabilities."""
    out = []
    for d in modules.get(m, {}).get("depends_on") or []:
        out += [d] if d in modules else providers_of(d, chosen, modules)
    return [d for d in out if d in chosen]


def ordered(chosen: set[str], modules: dict[str, dict]) -> list[str]:
    """Dependencies first; otherwise the order of house.example.yaml, then alphabetical."""
    rank = {m: i for i, m in enumerate(example_order())}
    pending = sorted(chosen, key=lambda m: (m != ALWAYS, rank.get(m, len(rank)), m))
    out: list[str] = []
    while pending:
        for m in pending:
            if all(d in out for d in needs(m, chosen, modules)):
                out.append(m)
                pending.remove(m)
                break
        else:
            sys.exit(f"circular depends_on between: {', '.join(pending)}")
    return out


def choose(modules: dict[str, dict], asker: Asker) -> list[str]:
    asker.collect_options(modules)
    chosen = {ALWAYS}
    for slug in ordered(set(modules) - {ALWAYS}, modules):
        meta = modules[slug]
        hint = ", ".join((meta.get("requires") or {}).get("hardware") or [])
        ok = True
        for q in questions_of(meta):
            need = str(q.get("need", "yes"))
            if asker.ask(q, hint if q is questions_of(meta)[0] else "") != need:
                ok = False
                break
        if ok:
            chosen.add(slug)
    changed = True
    while changed:
        changed = False
        for slug in sorted(chosen):
            for dep in modules.get(slug, {}).get("depends_on") or []:
                if dep in modules:
                    if dep not in chosen:
                        print(f"note: added {dep} (needed by {slug})")
                        chosen.add(dep)
                        changed = True
                elif not providers_of(dep, chosen, modules):
                    offer = providers_of(dep, modules, modules)
                    print(f"note: skipped {slug}: it needs '{dep}' and none of your choices provides it"
                          + (f" (modules that do: {', '.join(offer)})" if offer else " (no module provides it yet)"))
                    chosen.discard(slug)
                    changed = True
                    break
            if changed:
                break
    return ordered(chosen, modules)


ITEM = re.compile(r"^\s*-\s*([\w-]+)\s*(#.*)?$")


def modules_block(chosen: list[str], old_lines: list[str]) -> str:
    comments = {}
    for line in old_lines:
        m = ITEM.match(line)
        if m and m.group(2):
            comments[m.group(1)] = m.group(2)
    return "modules:\n" + "".join(f"  - {m}" + (f" {comments[m]}" if m in comments else "") + "\n" for m in chosen)


def replace_block(text: str, chosen: list[str]) -> str:
    lines = text.splitlines(keepends=True)
    start = next((i for i, line in enumerate(lines) if re.match(r"^modules\s*:", line)), None)
    if start is None:
        return text + ("" if text.endswith("\n") or not text else "\n") + "\n" + modules_block(chosen, [])
    end = start + 1
    while end < len(lines) and (lines[end].startswith((" ", "\t", "-")) and lines[end].strip()):
        end += 1
    return "".join(lines[:start]) + modules_block(chosen, lines[start:end]) + "".join(lines[end:])


def main() -> None:
    args = sys.argv[1:]
    house = Path(args[args.index("--house") + 1]) if "--house" in args else Path("house.yaml")
    answers_path = Path(args[args.index("--answers") + 1]) if "--answers" in args else None
    known = {"--house", "--answers", "--print"}
    flags = [a for a in args if a.startswith("-")]
    if any(a not in known for a in flags) or any(a in ("-h", "--help") for a in args):
        sys.exit(__doc__)
    answers = None
    if answers_path:
        answers = yaml.safe_load(answers_path.read_text(encoding="utf-8")) or {}
        if not isinstance(answers, dict):
            sys.exit(f"{answers_path}: expected a mapping question id -> answer")
    chosen = choose(load_modules(), Asker(answers))
    block = modules_block(chosen, [])
    if "--print" in args:
        print(block, end="")
        return

    if not house.exists():
        shutil.copy2(EXAMPLE, house)
        print(f"{house} did not exist: copied from house.example.yaml (fill in the rest of it)")
    text = house.read_text(encoding="utf-8")
    new = replace_block(text, chosen)
    try:
        old_data = yaml.safe_load(text) or {}
        new_data = yaml.safe_load(new) or {}
        safe = (new_data.get("modules") == chosen
                and {k: v for k, v in old_data.items() if k != "modules"} == {k: v for k, v in new_data.items() if k != "modules"})
    except yaml.YAMLError:
        safe = False
    if not safe:
        print(f"could not update {house} safely; paste this block yourself:\n")
        print(block, end="")
        sys.exit(1)
    house.write_text(new, encoding="utf-8")
    print(f"{house}: modules: {', '.join(chosen)}")


if __name__ == "__main__":
    main()
