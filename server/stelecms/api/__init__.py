"""API-Blueprints (SPEC §7, §9.8, §10)."""
from __future__ import annotations

from flask import Flask


def register_blueprints(app: Flask) -> None:
    from . import (agent, audit, auth, contents, dashboard, designs, fonts, monitoring, player, presentations, roles,
                   schedule, settings, steles, touch_menus, users)

    for mod in (auth, users, roles, contents, presentations, designs, fonts, touch_menus, steles, schedule, monitoring,
                dashboard, audit, settings, player, agent):
        app.register_blueprint(mod.bp)
