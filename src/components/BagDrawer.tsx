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
      className="fixed inset-0 z-50 flex justify-end bg-[#111111]/35 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Shopify Agent Shopping Bag"
    >
      <div className="w-full max-w-md bg-[#f2f2f2] h-full border-l border-[#1e1e1e]/15 flex flex-col">
        <div className="px-6 py-5 bg-white border-b border-[#1e1e1e]/10 flex items-center justify-between">
          <div>
            <h2 className="clash-display text-lg font-bold uppercase text-[#111111]">
              Shopping Bag
            </h2>
            <p className="text-[10px] uppercase tracking-wider text-[#838282] mt-1">
              Shopify UCP · Direct Merchant Checkout
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shopping bag"
            className="p-2 border border-[#1e1e1e]/15 text-[#111111] btn-invert cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 divide-y divide-[#1e1e1e]/10">
          {items.length === 0 ? (
            <div className="py-16 text-center bg-white border border-[#1e1e1e]/10 p-6">
              <ShoppingBag className="w-8 h-8 text-[#b6b5b5] mx-auto mb-3" />
              <p className="text-xs font-bold uppercase text-[#111111]">Bag is Empty</p>
              <p className="text-xs text-[#838282] mt-1.5 max-w-xs mx-auto leading-relaxed">
                Analyze a frame in Live Studio or search Shopify Global Catalog to stage matched
                items here.
              </p>
            </div>
          ) : (
            items.map(({ product, quantity }) => (
              <div key={product.id} className="py-4 first:pt-0 flex gap-4">
                <div className="w-20 h-20 bg-white border border-[#1e1e1e]/10 overflow-hidden shrink-0 flex items-center justify-center">
                  {product.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt={product.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ShoppingBag className="w-5 h-5 text-[#838282]" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-[#838282] truncate">
                    <span>{product.merchantName}</span>
                    {typeof product.fitScoreNormalized === 'number' && (
                      <>
                        <span aria-hidden="true"> · </span>
                        <span className="mono font-medium text-[#111111]">
                          {Math.round(product.fitScoreNormalized * 100)}% FIT
                        </span>
                      </>
                    )}
                  </div>
                  <h3 className="text-xs font-bold uppercase text-[#111111] mt-1 line-clamp-2">
                    {product.title}
                  </h3>
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <span className="mono text-xs font-bold text-[#111111]">
                      {formatPrice(product.priceAmountCents * quantity, product.currency)}
                    </span>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onUpdateQty(product.id, -1)}
                        aria-label="Decrease quantity"
                        className="w-7 h-7 flex items-center justify-center bg-white border border-[#1e1e1e]/20 text-[#111111] btn-invert cursor-pointer"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-7 text-center mono text-xs font-medium">{quantity}</span>
                      <button
                        type="button"
                        onClick={() => onUpdateQty(product.id, 1)}
                        aria-label="Increase quantity"
                        className="w-7 h-7 flex items-center justify-center bg-white border border-[#1e1e1e]/20 text-[#111111] btn-invert cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(product.id)}
                        aria-label="Remove item"
                        className="w-7 h-7 flex items-center justify-center text-[#838282] hover:text-red-600 ml-1 cursor-pointer"
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
                      className="mt-2.5 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase text-[#0052cc] hover:underline"
                    >
                      <span>Checkout · {product.merchantName}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {items.length > 0 && (
          <div className="px-6 py-5 border-t border-[#1e1e1e]/10 bg-white space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#838282]">
                Estimated Subtotal
              </span>
              <span className="mono text-lg font-bold text-[#111111]">
                {formatPrice(subtotalCents, currency)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClear}
                className="px-4 py-2.5 text-[11px] font-bold uppercase text-[#111111] bg-white border border-[#1e1e1e] btn-invert cursor-pointer"
              >
                Clear
              </button>
              {items[0]?.product.checkoutUrl && (
                <a
                  href={items[0].product.checkoutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-[11px] font-bold uppercase text-white bg-[#0052cc] hover:opacity-90 transition-opacity"
                >
                  <span>Checkout Top Merchant</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
