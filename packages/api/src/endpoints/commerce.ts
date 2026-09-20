import type { AxiosInstance } from 'axios';

// Money fields are Float in MAJOR units (e.g. GHS, not pesewas) -- matches
// apps/backend/prisma/schema.prisma's Product/Order models, never minor units.
export interface CreateProductInput {
  name: string;
  description?: string;
  sku?: string;
  priceMajorUnits: number;
  currency?: string;
  imageUrl?: string;
  stockQuantity?: number;
  minOrderQuantity?: number;
}

export function createCommerceProductsApi(client: AxiosInstance) {
  return {
    list: (activeOnly?: boolean) =>
      client.get('/commerce/products', { params: activeOnly ? { activeOnly: true } : undefined }),
    get: (id: string) => client.get(`/commerce/products/${id}`),
    create: (data: CreateProductInput) => client.post('/commerce/products', data),
    update: (id: string, data: Partial<CreateProductInput> & { isActive?: boolean }) =>
      client.patch(`/commerce/products/${id}`, data),
  };
}

export function createCommerceOrdersApi(client: AxiosInstance) {
  return {
    list: (status?: string) => client.get('/commerce/orders', { params: status ? { status } : undefined }),
    get: (id: string) => client.get(`/commerce/orders/${id}`),
    verifyPayment: (id: string) => client.post(`/commerce/orders/${id}/verify-payment`),
    updateFulfillment: (id: string, status: string) =>
      client.patch(`/commerce/orders/${id}/fulfillment`, { status }),
    cancel: (id: string, reason?: string) => client.patch(`/commerce/orders/${id}/cancel`, { reason }),
    approve: (id: string, customerEmail?: string) =>
      client.post(`/commerce/orders/${id}/approve`, { customerEmail }),
    reject: (id: string, reason?: string) => client.post(`/commerce/orders/${id}/reject`, { reason }),
  };
}
