"""ComfoClime 24 climate entity on the ComfoNet bus (RMI to node 12), see comfoclime_climate.h."""

import esphome.codegen as cg
from esphome.components import climate
import esphome.config_validation as cv

DEPENDENCIES = ["canbus"]

comfoclime_ns = cg.esphome_ns.namespace("comfoclime")
ComfoClimeClimate = comfoclime_ns.class_("ComfoClimeClimate", climate.Climate, cg.Component)

CONFIG_SCHEMA = climate.climate_schema(ComfoClimeClimate).extend(cv.COMPONENT_SCHEMA)


async def to_code(config):
    var = await climate.new_climate(config)
    await cg.register_component(var, config)
