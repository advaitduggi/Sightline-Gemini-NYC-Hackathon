import { ExternalLink, Package } from 'lucide-react';
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
    <article className="group flex flex-col">
      <div className="aspect-[4/3] bg-gradient-to-tr from-[#d1d1d1] to-[#f2f2f2] mb-3 relative overflow-hidden border border-[#1e1e1e]/10">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.title}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-[#838282] px-3 text-center">
            <Package className="w-6 h-6 opacity-40" />
            <span className="text-[10px] uppercase font-bold tracking-wider truncate max-w-full">
              {product.merchantName}
            </span>
          </div>
        )}

        {typeof product.fitScoreNormalized === 'number' && (
          <div className="absolute top-2 right-2 bg-white px-2 py-0.5 text-[9px] font-bold uppercase mono text-[#111111] border border-[#1e1e1e]/10">
            {Math.round(product.fitScoreNormalized * 100)}% FIT
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1 flex-1 justify-between">
        <div className="space-y-1">
          <div className="flex justify-between items-baseline gap-2">
            <h3 className="text-[11px] uppercase font-bold text-[#111111] truncate">
              {product.title}
            </h3>
            <span className="mono text-[11px] font-bold text-[#111111] shrink-0">
              {formattedPrice}
            </span>
          </div>

          <div className="text-[10px] text-[#838282] truncate">
            <span>{product.merchantName}</span>
            {product.fitLabel && (
              <>
                <span aria-hidden="true"> · </span>
                <span>{product.fitLabel}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex gap-2 mt-2">
          {product.checkoutUrl ? (
            <a
              href={product.checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 inline-flex items-center justify-center gap-1 bg-[#0052cc] text-white py-2 text-[10px] font-bold uppercase hover:opacity-90 transition-opacity"
            >
              <span>Buy</span>
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          ) : (
            <button
              type="button"
              onClick={() => onAddToBag(product)}
              className="flex-1 bg-[#0052cc] text-white py-2 text-[10px] font-bold uppercase hover:opacity-90 transition-opacity cursor-pointer"
            >
              Buy
            </button>
          )}
          <button
            type="button"
            onClick={() => onAddToBag(product)}
            className="flex-1 border border-[#111111] py-2 text-[10px] font-bold uppercase btn-invert cursor-pointer"
          >
            Add
          </button>
        </div>
      </div>
    </article>
  );
}
