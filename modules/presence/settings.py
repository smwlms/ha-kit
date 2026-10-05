<# Shared preamble (who and what this module follows): _presence.jinja in this folder. #>
<% from '_presence.jinja' import P, tracked, car_list, places, school, drop_offs, family, work, runs, calendar,
   stay_calendar, work_zone, windows, every, kind_of, det_of, stay_of, kind_title with context %>
<% set sleep = P.get('sleep_window') or module.defaults.sleep_window %>
<% set previous = P.get('previous_phones') or [] %>
<% for o in previous %>
<% if o.get('person') not in (tracked | map(attribute='key') | list) or not o.get('phone') or not o.get('until') %><@ fail('presence.previous_phones: every line has person (key of someone with a phone), phone and until ("YYYY-MM-DD HH:MM")') @><% endif %>
<% endfor %>
<% set people_rows = [] %>
<% for p in tracked %>
<% set _ = people_rows.append({'key': p.key, 'name': p.name, 'person': p.get('person') or 'person.' ~ p.key, 'work_zone': work_zone.get(p.key, '')}) %>
<% endfor %>
<% set car_rows = [] %>
<% for a in car_list %>
<% set _ = car_rows.append({'prefix': a.prefix, 'name': a.name, 'driver': a.driver if a.get('driver') in (tracked | map(attribute='key') | list) else '', 'location': car_entity(a, 'location'), 'charging_state': car_entity(a, 'charging_state'), 'battery': car_entity(a, 'battery')}) %>
<% endfor %>
<% set drop = {} %>
<% for z in drop_offs %>
<% set _ = drop.update({'zone.' ~ z.key: z.get('label') or z.name}) %>
<% endfor %>
<% set fam = {} %>
<% for f in family %>
<% set _ = fam.update({'zone.' ~ f.key: f.name}) %>
<% endfor %>
<# Texts the scripts write, in the install language (strings.yaml). #>
<% set text = {} %>
<% for k in ['word_and', 'unknown', 'stay_spots', 'stay_travel', 'stay_night', 'det_away', 'det_car', 'det_place',
             'det_source', 'det_duration', 'det_departure', 'det_work_trips', 'det_appointments', 'det_location',
             'det_battery', 'dur_hm', 'away_value', 'place_at_family', 'src_phone_with_car', 'src_usual_driver',
             'src_history', 'src_history_phone', 'src_history_driver_car', 'src_history_car_at_work', 'src_history_source'] %>
<% set _ = text.update({k: t(k)}) %>
<% endfor %>
<% set _ = text.update({'kind_stay': t('kind_stay')}) %>
"""Settings of module presence ("Our week"), filled in from house.yaml by ha-kit tools/fill.py.

Do not edit here: change house.yaml, fill in again and run presence/deploy.py. Imported by stay.py and workday.py
(on Home Assistant, in /config/presence/) and by backfill.py (on your computer). Standard library only.
"""
import json
import re
from datetime import datetime
from zoneinfo import ZoneInfo

TZ = ZoneInfo(<@ house.timezone | tojson @>)
# The recorder database, read-only. Only SQLite (the Home Assistant default) works; see presence/README.md.
DB = "file:/config/home-assistant_v2.db?mode=ro"


def _hm(text):
    hours, minutes = str(text).split(":")[:2]
    return int(hours), int(minutes)


def _ts(text):
    """Local "YYYY-MM-DD HH:MM" (or a date) -> timestamp."""
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(str(text), fmt).replace(tzinfo=TZ).timestamp()
        except ValueError:
            pass
    raise ValueError(f"time not recognised: {text!r} (expected YYYY-MM-DD HH:MM)")


# Sleeping window: at home this counts as asleep. The card gets the same window from its config.
NIGHT_START, NIGHT_END = _hm(<@ sleep.start | string | tojson @>), _hm(<@ sleep.end | string | tojson @>)
# People with a phone: key (helpers, person.<key>), name (as in the calendar), person entity, work zone ("" = none).
PEOPLE = json.loads(r'''<@ people_rows | tojson @>''')
# (phone tracker, name, valid from timestamp or None, valid until timestamp or None). A replaced phone
# (presence.previous_phones) counts until its switch moment, the current one from then on.
TRACKERS = [
<% for p in tracked %>
<% set old = previous | selectattr('person', 'eq', p.key) | list %>
<% for o in old %>
    ("device_tracker.<@ o.phone @>", <@ p.name | tojson @>, None, _ts(<@ o.until | string | tojson @>)),
<% endfor %>
    ("device_tracker.<@ p.phone @>", <@ p.name | tojson @>, <@ ('_ts(' ~ (old | map(attribute='until') | map('string') | max | tojson) ~ ')') if old else 'None' @>, None),
<% endfor %>
]
# Teslas: prefix, name, driver (person key or ""), and the Teslemetry entities this module reads.
CARS = json.loads(r'''<@ car_rows | tojson @>''')
# Places (zones from presence.places). SCHOOL: zone or None; DROP: drop-off zone -> label in the log;
# FAMILY: family zone -> zone name (logged as "<det_place>: <place_at_family>").
SCHOOL = <@ (('zone.' ~ school.key) | tojson) if school is not none else 'None' @>
SCHOOL_NAME = <@ (school.name if school is not none else '') | tojson @>
DROP = json.loads(r'''<@ drop | tojson @>''')
FAMILY = json.loads(r'''<@ fam | tojson @>''')
# Start values of the windows (schedule.school_drop_off, school_pick_up, family_pick_up): day -> "HH:MM-HH:MM".
# backfill.py prefers the schedules as they are in Home Assistant now.
WINDOWS = json.loads(r'''<@ windows | tojson @>''')
CALENDAR = <@ calendar | tojson @>
STAYS_CALENDAR = <@ stay_calendar | tojson @>
# Texts written into the calendars, in the install language (house.language; modules/presence/strings.yaml).
TEXT = json.loads(r'''<@ text | tojson @>''')
# Event titles by kind (home, home_from_work, drop_off, pick_up, work, charge) in the install language.
TITLE = json.loads(r'''<@ kind_title | tojson @>''')
# Reading events back: title, detail key and stay label of EVERY language in strings.yaml -> canonical name, so
# events written before a language switch are still recognised.
KIND_OF = json.loads(r'''<@ kind_of | tojson @>''')
DETAIL_OF = json.loads(r'''<@ det_of | tojson @>''')
STAY_OF = json.loads(r'''<@ stay_of | tojson @>''')
STAY_TITLES = json.loads(r'''<@ every.kind_stay | tojson @>''')
AND_WORDS = json.loads(r'''<@ every.word_and | tojson @>''')


def title(kind, who):
    """Calendar title "<title>: <names>" for a kind (canonical name) and a person name or a list of names."""
    names = who if isinstance(who, str) else f" {TEXT['word_and']} ".join(who)
    return f"{TITLE[kind]}: {names}"


def parse_title(summary):
    """(kind, names) of a log event title in any known language; kind None when it is not a log event.
    Stay events give ("stay", name)."""
    label, sep, rest = str(summary or "").partition(":")
    if not sep:
        return None, ""
    label = label.strip()
    if label in STAY_TITLES:
        return "stay", rest.strip()
    return KIND_OF.get(label), rest.strip()


def split_names(names):
    """["Jan", "Lien"] of "Jan and Lien" (the word "and" of any known language, or & and commas)."""
    words = "|".join(re.escape(w) for w in AND_WORDS)
    return [n.strip() for n in re.split(rf"\s+(?:{words})\s+|\s*[&,]\s*", str(names)) if n.strip()]


def parse_details(description):
    """{canonical key: value} of the "key: value" lines of an event (any known language); unknown keys stay as
    they are."""
    out = {}
    for line in str(description or "").splitlines():
        key, sep, value = line.partition(":")
        if sep:
            out[DETAIL_OF.get(key.strip(), key.strip())] = value.strip()
    return out


def format_details(details):
    """{canonical key: value} -> "key: value" lines in the install language."""
    return "\n".join(f"{TEXT.get('det_' + k, k)}: {v}" for k, v in details.items())


def duration(minutes):
    """"2 h 5 min" (install language) for a number of minutes."""
    minutes = int(minutes)
    return TEXT["dur_hm"].replace("{h}", str(minutes // 60)).replace("{m}", str(minutes % 60))
