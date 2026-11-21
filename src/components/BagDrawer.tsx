import { ExternalLink, Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react';
import { BagItem } from '../types';

interface BagDrawerProps {
  open: boolean;
  onClose: () => void;
  items: BagItem[];
  onUpdateQty: (productId: string, delta: number) => void;
  onRemove: (productId: string) => void;
  onClear: () => void;
}

export function BagDrawer({
  open,
  onClose,
  items,
  onUpdateQty,
  onRemove,
  onClear,
}: BagDrawerProps) {
  if (!open) return null;

  const subtotalCents = items.reduce(
    (sum, item) => sum + item.product.priceAmountCents * item.quantity,
    0,
  );
  const currency = items[0]?.product.currency || 'USD';

  const formatPrice = (cents: number, curr = 'USD') =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: curr,
    }).format(cents / 100);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-neutral-950/35 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Shopify Agent Shopping Bag"
    >
      <div className="w-full max-w-md bg-white h-full border-l border-neutral-200 flex flex-col">
        <div className="px-6 py-5 border-b border-neutral-200 flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-neutral-900">
              Agent Shopping Bag
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Live Shopify UCP merchant items · Direct checkout handoff
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shopping bag"
            className="p-2 text-neutral-500 hover:text-neutral-900 rounded-lg hover:bg-neutral-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 divide-y divide-neutral-200">
          {items.length === 0 ? (
            <div className="py-16 text-center">
              <ShoppingBag className="w-10 h-10 text-neutral-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-neutral-900">Your bag is empty</p>
              <p className="text-xs text-neutral-500 mt-1 max-w-xs mx-auto leading-relaxed">
                Analyze a live frame in Live Studio or search Shopify Global Catalog to pin matched products here.
              </p>
            </div>
          ) : (
            items.map(({ product, quantity }) => (
              <div key={product.id} className="py-4 first:pt-0 flex gap-4">
                <div className="w-20 h-20 rounded-lg bg-neutral-100 border border-neutral-200 overflow-hidden shrink-0 flex items-center justify-center">
                  {product.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt={product.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ShoppingBag className="w-6 h-6 text-neutral-400" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-xs text-neutral-500 truncate">
                    {product.merchantName}
                    {typeof product.fitScoreNormalized === 'number' && (
                      <>
                        <span aria-hidden="true"> · </span>
                        <span className="font-mono tabular-nums">
                          {Math.round(product.fitScoreNormalized * 100)}% fit
                        </span>
                      </>
                    )}
                  </div>
                  <h3 className="text-sm font-semibold text-neutral-900 mt-0.5 line-clamp-2">
                    {product.title}
                  </h3>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-medium text-neutral-900 tabular-nums">
                      {formatPrice(product.priceAmountCents * quantity, product.currency)}
                    </span>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onUpdateQty(product.id, -1)}
                        aria-label="Decrease quantity"
                        className="w-7 h-7 flex items-center justify-center rounded border border-neutral-200 text-neutral-700 hover:bg-neutral-100 cursor-pointer"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-6 text-center font-mono text-xs tabular-nums">
                        {quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => onUpdateQty(product.id, 1)}
                        aria-label="Increase quantity"
                        className="w-7 h-7 flex items-center justify-center rounded border border-neutral-200 text-neutral-700 hover:bg-neutral-100 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(product.id)}
                        aria-label="Remove item"
                        className="w-7 h-7 flex items-center justify-center rounded text-neutral-400 hover:text-red-600 hover:bg-red-50 ml-1 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {product.checkoutUrl && (
                    <a
                      href={product.checkoutUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-800 hover:underline"
                    >
                      <span>Checkout on {product.merchantName}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {items.length > 0 && (
          <div className="px-6 py-5 border-t border-neutral-200 bg-neutral-50 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-600">Estimated Subtotal</span>
              <span className="font-mono text-lg font-semibold text-neutral-900 tabular-nums">
                {formatPrice(subtotalCents, currency)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClear}
                className="px-4 py-2.5 text-sm font-medium text-neutral-700 bg-white border border-neutral-200 hover:bg-neutral-100 rounded-lg transition-colors cursor-pointer"
              >
                Clear
              </button>
              {items[0]?.product.checkoutUrl && (
                <a
                  href={items[0].product.checkoutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors"
                >
                  <span>Checkout Top Merchant</span>
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
