"""Config flow for Teslemetry route: a single entry without settings."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from . import DOMAIN


class TeslemetryRouteConfigFlow(ConfigFlow, domain=DOMAIN):
    """Create the single Teslemetry route entry."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Create the entry without asking anything."""
        return self.async_create_entry(title="Teslemetry route", data={})
