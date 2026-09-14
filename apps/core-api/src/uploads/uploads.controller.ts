import { BadRequestException, Controller, Post, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TenantMatchGuard } from "../auth/guards/tenant-match.guard";
import { CurrentTenant } from "../tenancy/current-tenant.decorator";
import type { TenantContext } from "../tenancy/tenant-resolver.middleware";
import { S3Service } from "./s3.service";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB — product photos, not video
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Not nested under /products (e.g. POST /products/:id/image) — a new
// product doesn't have an id yet when its image is first picked in the
// form, so the image is uploaded standalone and the resulting URL is
// just one field in the create/update payload, same as name or price.
@Controller("uploads")
@UseGuards(JwtAuthGuard, TenantMatchGuard)
export class UploadsController {
  constructor(private readonly s3: S3Service) {}

  @Post("product-image")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(), // buffer in memory, never touches this container's disk
      limits: { fileSize: MAX_BYTES },
    }),
  )
  async uploadProductImage(@UploadedFile() file: Express.Multer.File | undefined, @CurrentTenant() tenant: TenantContext) {
    if (!file) throw new BadRequestException("No file uploaded");
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      throw new BadRequestException("File must be a JPEG, PNG, WebP, or GIF image");
    }

    // Namespaced by tenant, not just "products/" — keeps one tenant's
    // uploads from being trivially guessable/enumerable from another's,
    // the same instinct as RLS even though S3 itself has no tenant concept.
    const url = await this.s3.upload(file.buffer, `products/${tenant.id}`, file.mimetype, file.originalname);
    return { url };
  }
}
