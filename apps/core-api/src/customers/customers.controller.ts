import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TenantMatchGuard } from "../auth/guards/tenant-match.guard";
import { ImportRowsDto } from "../common/dto/import-rows.dto";
import { CurrentTenant } from "../tenancy/current-tenant.decorator";
import type { TenantContext } from "../tenancy/tenant-resolver.middleware";
import { CustomersService } from "./customers.service";
import { CreateCustomerDto } from "./dto/create-customer.dto";
import { QueryCustomersDto } from "./dto/query-customers.dto";
import { UpdateCustomerDto } from "./dto/update-customer.dto";

// Staff-only, no public read — a customer's own data is reachable only
// through the storefront/auth surface (its own guard, its own token),
// never this one.
@Controller("customers")
@UseGuards(JwtAuthGuard, TenantMatchGuard)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@Query() query: QueryCustomersDto, @CurrentTenant() tenant: TenantContext) {
    return this.customers.list(tenant.id, query);
  }

  // Before ":id" — see ProductsController's exportCsv for why the order matters.
  @Get("export")
  async exportCsv(@Query() query: QueryCustomersDto, @CurrentTenant() tenant: TenantContext, @Res() res: Response) {
    const csv = await this.customers.exportCsv(tenant.id, query);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="customers-${tenant.slug}.csv"`);
    res.send(csv);
  }

  @Post()
  create(@Body() dto: CreateCustomerDto, @CurrentTenant() tenant: TenantContext) {
    return this.customers.create(tenant.id, dto);
  }

  @Post("import")
  importRows(@Body() dto: ImportRowsDto, @CurrentTenant() tenant: TenantContext) {
    return this.customers.importRows(tenant.id, dto.rows);
  }

  @Get(":id")
  async findOne(@Param("id") id: string, @CurrentTenant() tenant: TenantContext) {
    const customer = await this.customers.findById(tenant.id, id);
    if (!customer) throw new NotFoundException("Customer not found");
    return customer;
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() dto: UpdateCustomerDto, @CurrentTenant() tenant: TenantContext) {
    const customer = await this.customers.update(tenant.id, id, dto);
    if (!customer) throw new NotFoundException("Customer not found");
    return customer;
  }

  @Delete(":id")
  async remove(@Param("id") id: string, @CurrentTenant() tenant: TenantContext) {
    const customer = await this.customers.delete(tenant.id, id);
    if (!customer) throw new NotFoundException("Customer not found");
    return customer;
  }
}
