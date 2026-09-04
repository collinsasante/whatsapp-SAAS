import { ProductsService } from '../../commerce/products/products.service';
import { ToolDefinition, ToolExecutionContext } from './tool-registry.types';

/**
 * Verz-AI unification, Phase G: the first tool with a real customer-visible
 * side effect beyond text -- reuses the product's existing imageUrl (already
 * captured via the admin product CRUD) and the already-working upload-to-Meta
 * chain (see MessagesService.deliverMedia), which previously only human agents
 * and bot-flow image nodes could trigger. Returns sent:false rather than lying
 * when a product has no image, so Verz can say so honestly instead of silently
 * doing nothing or claiming to have sent something it didn't.
 */
export function buildMediaTools(products: ProductsService): ToolDefinition[] {
  return [
    {
      def: {
        name: 'send_product_image',
        description: "Send the customer a photo of a specific product you've already found via search_products or get_product_details. This actually sends the image as a real WhatsApp message -- it is a visible action, not just information for you. Check that the product has an image (via get_product_details) before calling this; if it doesn't, tell the customer you don't have a photo right now rather than calling this tool.",
        parameters: {
          type: 'object',
          properties: { productId: { type: 'string' } },
          required: ['productId'],
        },
      },
      execute: async (ctx: ToolExecutionContext, args) => {
        const productId = args['productId'] as string;
        if (!productId) return { error: 'productId is required' };
        const product = await products.findOne(ctx.tenantId, productId).catch(() => null);
        if (!product) return { error: 'Product not found' };
        if (!product.imageUrl) return { forModel: { sent: false, reason: 'no_image_available' } };
        return {
          forModel: { sent: true, product: product.name },
          sideEffect: { type: 'send_media' as const, mediaUrl: product.imageUrl, mediaType: 'IMAGE' as const, caption: product.name, productId: product.id },
        };
      },
    },
  ];
}
