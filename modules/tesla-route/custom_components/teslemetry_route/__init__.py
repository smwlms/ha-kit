"""Teslemetry route: exposes the Tesla navigation route (Fleet Telemetry RouteLine) as a sensor per vehicle.

Rides on the streaming connection of the core Teslemetry integration (entry.runtime_data.vehicles[].stream_vehicle),
so it needs no token of its own. See LOGIC.md of the ha-kit module tesla-route.
"""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryNotReady

DOMAIN = "teslemetry_route"
PLATFORMS = [Platform.SENSOR]


def loaded_teslemetry_entries(hass: HomeAssistant) -> list[ConfigEntry]:
    """Return the Teslemetry config entries that are loaded."""
    return [
        entry
        for entry in hass.config_entries.async_entries("teslemetry")
        if entry.state is ConfigEntryState.LOADED
    ]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up the route sensors once Teslemetry is loaded."""
    teslemetry = loaded_teslemetry_entries(hass)
    if not teslemetry:
        raise ConfigEntryNotReady("Teslemetry is not loaded yet")
    # A Teslemetry reload creates a new stream object; reload this entry so the listeners follow it.
    def _follow_reload() -> None:
        if hass.config_entries.async_get_entry(entry.entry_id) is not None:
            hass.async_create_task(hass.config_entries.async_reload(entry.entry_id))

    for te_entry in teslemetry:
        te_entry.async_on_unload(_follow_reload)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload the route sensors."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
