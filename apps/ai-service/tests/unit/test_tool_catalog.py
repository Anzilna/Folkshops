"""
Pins the tool contracts shared with core-api (src/mcp/{staff,customer}-tools.ts).
A change here must be mirrored there — ToolRegistry hides any tool whose
argument names/required-ness drift between the two at runtime.
"""

import pytest

from app.domain.tools.catalog import CATALOG, UpdateProductArgs
from app.domain.tools.spec import Tier, clean_schema, schema_compatible

EXPECTED = {
    "store_copilot": {
        "knowledge_search": ({"query"}, {"query"}),
        "search_products": ({"query", "status", "limit"}, set()),
        "get_product": ({"product_id"}, {"product_id"}),
        "list_inventory": ({"query", "sort", "limit"}, set()),
        "search_orders": ({"status", "query", "limit"}, set()),
        "get_order": ({"order_id"}, {"order_id"}),
        "get_customer": ({"customer_id"}, {"customer_id"}),
        "update_product": ({"product_id", "name", "price_cents", "status", "is_active"}, {"product_id"}),
        "set_inventory_quantity": ({"product_id", "quantity"}, {"product_id", "quantity"}),
    },
    "shopper_assistant": {
        "knowledge_search": ({"query"}, {"query"}),
        "search_products": ({"query", "limit"}, set()),
        "get_product": ({"product_id"}, {"product_id"}),
        "get_cart": (set(), set()),
        "set_cart_item_quantity": ({"product_id", "quantity"}, {"product_id", "quantity"}),
        "list_my_orders": ({"limit"}, set()),
        "get_my_order": ({"order_id"}, {"order_id"}),
    },
}


@pytest.mark.parametrize("profile", sorted(EXPECTED))
def test_catalog_matches_the_core_api_contract(profile):
    specs = {s.name: s for s in CATALOG[profile]}
    assert set(specs) == set(EXPECTED[profile])
    for name, (props, required) in EXPECTED[profile].items():
        schema = specs[name].llm_schema()
        assert set(schema.get("properties", {})) == props, name
        assert set(schema.get("required", [])) == required, name


def test_no_tool_takes_an_identity_argument():
    forbidden = {"tenant_id", "tenantId", "store_id", "customer_id_self", "actor_id", "user_id"}
    for specs in CATALOG.values():
        for spec in specs:
            assert not forbidden & set(spec.llm_schema().get("properties", {})), spec.name


def test_shopper_tools_never_need_confirmation_and_never_touch_business_data():
    tiers = {s.tier for s in CATALOG["shopper_assistant"]}
    assert Tier.WRITE_CONFIRM not in tiers


def test_copilot_mutations_all_require_confirmation():
    for spec in CATALOG["store_copilot"]:
        if spec.mutating:
            assert spec.requires_confirmation, spec.name


def test_clean_schema_collapses_optional_and_drops_titles():
    schema = clean_schema(UpdateProductArgs.model_json_schema())
    assert "title" not in schema
    assert schema["properties"]["price_cents"]["type"] == "integer"
    assert "anyOf" not in schema["properties"]["name"]


def test_schema_compatibility_detects_renamed_argument():
    ours = {"properties": {"product_id": {}, "quantity": {}}, "required": ["product_id", "quantity"]}
    assert schema_compatible(
        ours, {"properties": {"product_id": {}, "quantity": {}}, "required": ["quantity", "product_id"]}
    )
    assert not schema_compatible(ours, {"properties": {"product_id": {}, "qty": {}}, "required": ["product_id", "qty"]})
    assert not schema_compatible(ours, {"properties": {"product_id": {}, "quantity": {}}, "required": ["product_id"]})


def test_update_product_requires_a_change():
    with pytest.raises(ValueError):
        UpdateProductArgs.model_validate({"product_id": "6f1c1c1e-6b8a-4d4e-9c39-5b6a0f8e2a11"})


def test_arguments_reject_unknown_keys():
    with pytest.raises(ValueError):
        UpdateProductArgs.model_validate(
            {"product_id": "6f1c1c1e-6b8a-4d4e-9c39-5b6a0f8e2a11", "name": "x", "tenant_id": "other-store"}
        )
