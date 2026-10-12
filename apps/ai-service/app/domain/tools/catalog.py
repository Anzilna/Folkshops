"""
Every tool the agent can ever expose, per profile. This is the allowlist:
an MCP tool core-api serves but this catalog doesn't list is never shown to
the model, and one listed here but missing (or with different argument
names) on the server is hidden for that run — see ToolRegistry.

MCP tools here must match apps/core-api/src/mcp/{staff,customer}-tools.ts
(names, argument names, required-ness). tests/unit/test_tool_catalog.py
pins the shapes; the live check in ToolRegistry catches drift at runtime.

No tool takes a tenant, store, customer or user id that identifies WHO is
acting — that comes from the verified token on both sides. Arguments are
typed and bounded; there is no free-form query language, SQL, URL or HTTP
method anywhere.
"""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.domain.tools.spec import Profile, Tier, ToolSpec

ProductStatus = Literal["draft", "active", "archived"]
OrderStatus = Literal[
    "pending", "awaiting_payment", "paid", "payment_failed", "cancelled", "refunded", "partially_refunded"
]


class _Args(BaseModel):
    # Unknown arguments (a smuggled tenant_id, a typo) are a validation
    # error the model has to fix — never silently dropped.
    model_config = ConfigDict(extra="forbid")


class KnowledgeSearchArgs(_Args):
    query: str = Field(min_length=1, max_length=300, description="What to look up in the store's documents.")


class SearchProductsStaffArgs(_Args):
    query: str | None = Field(default=None, max_length=200, description="Words to match in name/description.")
    status: ProductStatus | None = None
    limit: int | None = Field(default=None, ge=1, le=20)


class SearchProductsShopperArgs(_Args):
    query: str | None = Field(default=None, max_length=200, description="Words to match in name/description.")
    limit: int | None = Field(default=None, ge=1, le=20)


class GetProductArgs(_Args):
    product_id: UUID


class ListInventoryArgs(_Args):
    query: str | None = Field(default=None, max_length=200, description="Product name to filter by.")
    sort: Literal["lowest_first", "recently_updated"] | None = None
    limit: int | None = Field(default=None, ge=1, le=20)


class SearchOrdersArgs(_Args):
    status: OrderStatus | None = None
    query: str | None = Field(default=None, max_length=50, description="Part of the customer's phone number.")
    limit: int | None = Field(default=None, ge=1, le=20)


class GetOrderArgs(_Args):
    order_id: UUID


class GetCustomerArgs(_Args):
    customer_id: UUID


class UpdateProductArgs(_Args):
    product_id: UUID
    name: str | None = Field(default=None, min_length=1, max_length=200)
    price_cents: int | None = Field(default=None, ge=0, le=100_000_000, description="New price in fils (cents).")
    status: ProductStatus | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def _something_to_change(self) -> "UpdateProductArgs":
        if self.name is None and self.price_cents is None and self.status is None and self.is_active is None:
            raise ValueError("give at least one of name, price_cents, status, is_active")
        return self


class SetInventoryQuantityArgs(_Args):
    product_id: UUID
    quantity: int = Field(ge=0, le=1_000_000, description="The new total stock (not an amount to add).")


class EmptyArgs(_Args):
    pass


class SetCartItemQuantityArgs(_Args):
    product_id: UUID
    quantity: int = Field(ge=0, le=99, description="The new quantity in the cart (not an amount to add). 0 removes it.")


class ListMyOrdersArgs(_Args):
    limit: int | None = Field(default=None, ge=1, le=20)


class GetMyOrderArgs(_Args):
    order_id: UUID


def _knowledge(profile: Profile) -> ToolSpec:
    return ToolSpec(
        name="knowledge_search",
        description="Search the store's own documents (policies, FAQs, shipping, returns, guides). "
        "Use it for any question about how the store works.",
        args_model=KnowledgeSearchArgs,
        provider="local",
        profile=profile,
        tier=Tier.READ_PUBLIC,
        timeout_s=5.0,
        max_retries=0,
        max_calls_per_run=3,
    )


STORE_COPILOT_TOOLS: tuple[ToolSpec, ...] = (
    _knowledge("store_copilot"),
    ToolSpec(
        name="search_products",
        description="Search this store's products (including drafts/archived). Returns ids, names, prices in fils.",
        args_model=SearchProductsStaffArgs,
        provider="mcp",
        profile="store_copilot",
        tier=Tier.READ_SCOPED,
        timeout_s=4.0,
        max_calls_per_run=3,
    ),
    ToolSpec(
        name="get_product",
        description="Get one product's full details by id.",
        args_model=GetProductArgs,
        provider="mcp",
        profile="store_copilot",
        tier=Tier.READ_SCOPED,
        timeout_s=3.0,
    ),
    ToolSpec(
        name="list_inventory",
        description="Stock levels. sort=lowest_first to find products running out.",
        args_model=ListInventoryArgs,
        provider="mcp",
        profile="store_copilot",
        tier=Tier.READ_SCOPED,
        timeout_s=4.0,
        max_calls_per_run=3,
    ),
    ToolSpec(
        name="search_orders",
        description="List this store's orders, newest first, optionally by status or customer phone fragment.",
        args_model=SearchOrdersArgs,
        provider="mcp",
        profile="store_copilot",
        tier=Tier.READ_SCOPED,
        timeout_s=4.0,
        max_calls_per_run=3,
        sensitive_args=frozenset({"query"}),
    ),
    ToolSpec(
        name="get_order",
        description="Get one order with its line items.",
        args_model=GetOrderArgs,
        provider="mcp",
        profile="store_copilot",
        tier=Tier.READ_SCOPED,
        timeout_s=3.0,
    ),
    ToolSpec(
        name="get_customer",
        description="Get a customer's name and masked phone number by id.",
        args_model=GetCustomerArgs,
        provider="mcp",
        profile="store_copilot",
        tier=Tier.READ_SCOPED,
        timeout_s=3.0,
    ),
    ToolSpec(
        name="update_product",
        description="Propose changing a product's name, price, status or active flag. "
        "Nothing changes until the merchant presses Confirm.",
        args_model=UpdateProductArgs,
        provider="mcp",
        profile="store_copilot",
        tier=Tier.WRITE_CONFIRM,
        timeout_s=6.0,
        max_calls_per_run=1,
    ),
    ToolSpec(
        name="set_inventory_quantity",
        description="Propose setting a product's total stock. Nothing changes until the merchant presses Confirm.",
        args_model=SetInventoryQuantityArgs,
        provider="mcp",
        profile="store_copilot",
        tier=Tier.WRITE_CONFIRM,
        timeout_s=6.0,
        max_calls_per_run=1,
    ),
)

SHOPPER_ASSISTANT_TOOLS: tuple[ToolSpec, ...] = (
    _knowledge("shopper_assistant"),
    ToolSpec(
        name="search_products",
        description="Search the store's catalog. Returns ids, names and prices in fils.",
        args_model=SearchProductsShopperArgs,
        provider="mcp",
        profile="shopper_assistant",
        tier=Tier.READ_PUBLIC,
        timeout_s=4.0,
        max_calls_per_run=3,
    ),
    ToolSpec(
        name="get_product",
        description="Get one product's details by id.",
        args_model=GetProductArgs,
        provider="mcp",
        profile="shopper_assistant",
        tier=Tier.READ_PUBLIC,
        timeout_s=3.0,
    ),
    ToolSpec(
        name="get_cart",
        description="Get the shopper's current cart.",
        args_model=EmptyArgs,
        provider="mcp",
        profile="shopper_assistant",
        tier=Tier.READ_SCOPED,
        timeout_s=3.0,
    ),
    ToolSpec(
        name="set_cart_item_quantity",
        description="Set how many of one product are in the shopper's cart (0 removes it). "
        "Only when the shopper asked.",
        args_model=SetCartItemQuantityArgs,
        provider="mcp",
        profile="shopper_assistant",
        tier=Tier.WRITE_LOW,
        timeout_s=4.0,
        max_calls_per_run=3,
    ),
    ToolSpec(
        name="list_my_orders",
        description="List the shopper's own orders, newest first.",
        args_model=ListMyOrdersArgs,
        provider="mcp",
        profile="shopper_assistant",
        tier=Tier.READ_SCOPED,
        timeout_s=3.0,
    ),
    ToolSpec(
        name="get_my_order",
        description="Get one of the shopper's own orders with its items.",
        args_model=GetMyOrderArgs,
        provider="mcp",
        profile="shopper_assistant",
        tier=Tier.READ_SCOPED,
        timeout_s=3.0,
    ),
)

CATALOG: dict[str, tuple[ToolSpec, ...]] = {
    "store_copilot": STORE_COPILOT_TOOLS,
    "shopper_assistant": SHOPPER_ASSISTANT_TOOLS,
}
