"""Sensor per Tesla with the navigation route from Fleet Telemetry RouteLine."""

from __future__ import annotations

from datetime import datetime

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from . import loaded_teslemetry_entries
from .decode import decode_route_line


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Add a route sensor for every streaming Teslemetry vehicle."""
    async_add_entities(
        TeslaRouteSensor(vehicle)
        for te_entry in loaded_teslemetry_entries(hass)
        for vehicle in te_entry.runtime_data.vehicles
        if getattr(vehicle, "stream_vehicle", None) is not None
    )


class TeslaRouteSensor(SensorEntity):
    """Number of route points; the route itself is the 'route' attribute (not recorded)."""

    _attr_has_entity_name = True
    _attr_name = "Tesla route"
    _attr_icon = "mdi:map-marker-path"
    _attr_should_poll = False
    _attr_native_unit_of_measurement = <@ t('sensor_unit_points') | tojson @>
    _unrecorded_attributes = frozenset({"route", "raw_start"})

    def __init__(self, vehicle) -> None:
        self._vehicle = vehicle
        self._attr_unique_id = f"{vehicle.vin}-tesla_route"
        self._attr_device_info = vehicle.device
        self._attr_native_value = 0
        self._attr_extra_state_attributes = {"route": [], "format": None, "updated": None}

    async def async_added_to_hass(self) -> None:
        """Listen to RouteLine on the Teslemetry stream (this also enables the field for the car)."""
        self.async_on_remove(self._vehicle.stream_vehicle.listen_RouteLine(self._handle))

    def _car_position(self) -> list[float] | None:
        """Current position of this car from its Teslemetry location tracker (unique_id '<vin>-location')."""
        entity_id = er.async_get(self.hass).async_get_entity_id(
            "device_tracker", "teslemetry", f"{self._vehicle.vin}-location"
        )
        state = self.hass.states.get(entity_id) if entity_id else None
        if state and isinstance(state.attributes.get("latitude"), (int, float)):
            return [state.attributes["latitude"], state.attributes["longitude"]]
        return None

    @callback
    def _handle(self, value: str | None) -> None:
        now: datetime = dt_util.utcnow()
        if not value:
            self._attr_native_value = 0
            self._attr_extra_state_attributes = {"route": [], "format": None, "updated": now.isoformat()}
        else:
            points, fmt = decode_route_line(value, self._car_position())
            self._attr_native_value = len(points)
            self._attr_extra_state_attributes = {
                "route": points,
                "format": fmt,
                "updated": now.isoformat(),
                "raw_length": len(value),
                "raw_start": value[:80],
            }
        self.async_write_ha_state()
