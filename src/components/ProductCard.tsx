import { ExternalLink, Package, Plus } from 'lucide-react';
import { CatalogProduct } from '../types';

interface ProductCardProps {
  product: CatalogProduct;
  onAddToBag: (product: CatalogProduct) => void;
}

export function ProductCard({ product, onAddToBag }: ProductCardProps) {
  const formattedPrice = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: product.currency || 'USD',
  }).format((product.priceAmountCents || 0) / 100);

  return (
    <article className="bg-white border border-neutral-200 rounded-xl overflow-hidden flex flex-col transition-transform duration-150 hover:-translate-y-0.5">
      <div className="aspect-[4/3] bg-neutral-100 border-b border-neutral-200 overflow-hidden flex items-center justify-center">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.title}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-neutral-400 px-4 text-center">
            <Package className="w-7 h-7" />
            <span className="text-xs font-medium text-neutral-500 line-clamp-1">
              {product.merchantName}
            </span>
          </div>
        )}
      </div>

      <div className="p-4 flex-1 flex flex-col justify-between gap-3">
        <div>
          <div className="text-xs text-neutral-500 truncate">
            <span>{product.merchantName}</span>
            {typeof product.fitScoreNormalized === 'number' && (
              <>
                <span aria-hidden="true"> · </span>
                <span className="font-mono font-medium text-neutral-800 tabular-nums">
                  {Math.round(product.fitScoreNormalized * 100)}% fit
                </span>
              </>
            )}
            {product.fitLabel && (
              <>
                <span aria-hidden="true"> · </span>
                <span>{product.fitLabel}</span>
              </>
            )}
          </div>

          <h3 className="text-sm font-semibold text-neutral-900 mt-1 line-clamp-2 leading-snug">
            {product.title}
          </h3>

          {product.descriptionSnippet && (
            <p className="text-xs text-neutral-500 mt-1.5 line-clamp-2 leading-relaxed">
              {product.descriptionSnippet}
            </p>
          )}
        </div>

        <div className="pt-3 border-t border-neutral-100 flex items-center justify-between gap-2">
          <span className="font-mono text-sm font-semibold text-neutral-900 tabular-nums">
            {formattedPrice}
          </span>

          <div className="flex items-center gap-2 shrink-0">
            {product.checkoutUrl && (
              <a
                href={product.checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:text-neutral-950 border border-neutral-200 hover:bg-neutral-50 rounded-lg transition-colors whitespace-nowrap"
              >
                <span>Buy</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <button
              type="button"
              onClick={() => onAddToBag(product)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
