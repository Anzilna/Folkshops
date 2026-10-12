import { Controller, Get } from "@nestjs/common";
import { PlansService } from "./plans.service";

/** Public — apps/marketing's /pricing page fetches this with no auth at all, same posture as GET /products. */
@Controller("plans")
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  list() {
    return this.plans.listActive();
  }
}
