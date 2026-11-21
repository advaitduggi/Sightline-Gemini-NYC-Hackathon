import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Search, Store } from 'lucide-react';
import { CatalogProduct } from '../types';
import { ProductCard } from './ProductCard';

interface CatalogViewProps {
  storefrontMcpUrl: string;
  onChangeStorefrontMcpUrl: (url: string) => void;
  onAddToBag: (product: CatalogProduct) => void;
}

const SUGGESTED_QUERIES = [
  'cordless brass minimalist table lamp',
  'matte black gooseneck pour over kettle',
  'coiled mechanical keyboard cable dark',
  'olive waffle weave kitchen linen towel',
];

export function CatalogView({
  storefrontMcpUrl,
  onChangeStorefrontMcpUrl,
  onAddToBag,
}: CatalogViewProps) {
  const [query, setQuery] = useState(SUGGESTED_QUERIES[0]);
  const [maxPriceUsd, setMaxPriceUsd] = useState<string>('150');
  const [loading, setLoading] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [endpointUsed, setEndpointUsed] = useState<string>('');
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [error, setError] = useState<string | null>(null);

  const runSearch = async (searchQuery: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/shopify/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: searchQuery,
          limit: 9,
          maxPriceUsd: maxPriceUsd ? Number(maxPriceUsd) : undefined,
          storefrontMcpUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Shopify MCP search failed (HTTP ${res.status})`);
      }
      setProducts(data.products || []);
      setLatencyMs(data.latencyMs ?? null);
      setEndpointUsed(data.endpoint || 'https://catalog.shopify.com/api/ucp/mcp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Shopify MCP search error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runSearch(SUGGESTED_QUERIES[0]);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      runSearch(query.trim());
    }
  };

  return (
    <div className="max-w-[1920px] mx-auto p-6 lg:p-8 space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-6 border-b border-[#1e1e1e]/10">
        <div>
          <h1 className="clash-display text-3xl font-bold uppercase text-[#111111]">
            Shopify Global Catalog MCP
          </h1>
          <p className="text-xs text-[#838282] mt-2 max-w-2xl leading-relaxed">
            Direct JSON-RPC 2.0 discovery via{' '}
            <span className="mono text-[#111111]">catalog.shopify.com/api/ucp/mcp</span> or an
            optional custom merchant Storefront MCP endpoint.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-[#838282]">
          <Store className="w-4 h-4 text-[#0052cc]" />
          <input
            type="url"
            value={storefrontMcpUrl}
            onChange={(e) => onChangeStorefrontMcpUrl(e.target.value)}
            placeholder="Optional: https://{shop}.myshopify.com/api/mcp"
            aria-label="Optional custom Shopify Storefront MCP URL"
            className="w-72 px-3 py-2 text-xs bg-white border border-[#1e1e1e]/15 text-[#111111] placeholder:text-[#b6b5b5] focus:outline-none focus:border-[#0052cc]"
          />
        </div>
      </div>

      {/* Search Form */}
      <div className="bg-white border border-[#1e1e1e]/10 p-6 space-y-4">
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#838282] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search across Shopify merchants..."
              aria-label="Search Shopify Global Catalog"
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-[#f2f2f2] border border-[#1e1e1e]/15 focus:outline-none focus:border-[#0052cc]"
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-[10px] font-bold uppercase text-[#838282] bg-[#f2f2f2] border border-[#1e1e1e]/15 px-3 py-2.5">
              <span>Max USD</span>
              <input
                type="number"
                min={5}
                max={5000}
                value={maxPriceUsd}
                onChange={(e) => setMaxPriceUsd(e.target.value)}
                className="w-16 mono text-xs bg-transparent focus:outline-none text-[#111111]"
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 text-[11px] font-bold uppercase text-white bg-[#0052cc] hover:opacity-90 disabled:opacity-60 transition-opacity whitespace-nowrap cursor-pointer"
            >
              {loading ? 'Searching...' : 'Search Catalog'}
            </button>
          </div>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {SUGGESTED_QUERIES.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  setQuery(q);
                  runSearch(q);
                }}
                className={`px-3 py-1.5 text-[10px] font-bold uppercase border transition-colors cursor-pointer ${
                  query === q
                    ? 'bg-black text-white border-black'
                    : 'bg-white text-[#111111] border-[#1e1e1e]/15 hover:bg-[#1e1e1e]/5'
                }`}
              >
                {q}
              </button>
            ))}
          </div>

          {latencyMs !== null && (
            <span className="mono text-[10px] text-[#838282]">
              {products.length} ITEMS · {latencyMs}MS · {endpointUsed.replace('https://', '')}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-4 bg-white border border-red-600/50 flex items-start gap-3 text-xs text-red-900"
        >
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold uppercase">Shopify MCP Error</p>
            <p className="text-red-800 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-16 flex flex-col items-center justify-center gap-3 text-[#838282]">
          <Loader2 className="w-6 h-6 animate-spin text-[#0052cc]" />
          <span className="text-[11px] font-bold uppercase">
            Querying Shopify Global Catalog MCP...
          </span>
        </div>
      ) : products.length === 0 ? (
        <div className="py-16 text-center bg-white border border-[#1e1e1e]/10">
          <p className="text-xs font-bold uppercase text-[#111111]">No Available Products Found</p>
          <p className="text-xs text-[#838282] mt-1">
            Raise the max price cap or adjust your material keywords.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} onAddToBag={onAddToBag} />
          ))}
        </div>
      )}
    </div>
  );
}
