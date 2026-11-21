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
    <div className="max-w-[1440px] mx-auto px-6 py-8 space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-6 border-b border-neutral-200">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-neutral-950 text-balance">
            Shopify Global Catalog MCP Explorer
          </h1>
          <p className="text-sm text-neutral-600 mt-1.5 max-w-2xl leading-relaxed">
            Direct JSON-RPC 2.0 discovery against Shopify’s Universal Commerce Protocol endpoint (
            <span className="font-mono text-xs">catalog.shopify.com/api/ucp/mcp</span>) or any custom
            merchant Storefront MCP URL.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-neutral-600">
          <Store className="w-4 h-4 text-neutral-500" />
          <input
            type="url"
            value={storefrontMcpUrl}
            onChange={(e) => onChangeStorefrontMcpUrl(e.target.value)}
            placeholder="Optional: https://{shop}.myshopify.com/api/mcp"
            aria-label="Optional custom Shopify Storefront MCP URL"
            className="w-72 px-3 py-2 text-xs bg-white border border-neutral-200 rounded-lg focus:outline-none focus:border-blue-700"
          />
        </div>
      </div>

      {/* Search Form & Preset Chips */}
      <div className="bg-white border border-neutral-200 rounded-xl p-5 space-y-4">
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search across Shopify merchants..."
              aria-label="Search Shopify Global Catalog"
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:border-blue-700"
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2">
              <span>Max USD</span>
              <input
                type="number"
                min={5}
                max={5000}
                value={maxPriceUsd}
                onChange={(e) => setMaxPriceUsd(e.target.value)}
                className="w-16 font-mono text-xs bg-transparent focus:outline-none text-neutral-900 tabular-nums"
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              {loading ? 'Searching...' : 'Search Catalog'}
            </button>
          </div>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            {SUGGESTED_QUERIES.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  setQuery(q);
                  runSearch(q);
                }}
                className={`px-3 py-1 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                  query === q
                    ? 'bg-neutral-900 text-white border-neutral-900'
                    : 'bg-neutral-50 text-neutral-700 border-neutral-200 hover:bg-neutral-100'
                }`}
              >
                {q}
              </button>
            ))}
          </div>

          {latencyMs !== null && (
            <span className="font-mono text-xs text-neutral-500 tabular-nums">
              {products.length} products · {latencyMs}ms · {endpointUsed.replace('https://', '')}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-sm text-red-900"
        >
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Shopify MCP Error</p>
            <p className="text-red-800 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-16 flex flex-col items-center justify-center gap-3 text-neutral-500">
          <Loader2 className="w-7 h-7 animate-spin text-blue-700" />
          <span className="text-sm">Querying Shopify Global Catalog MCP...</span>
        </div>
      ) : products.length === 0 ? (
        <div className="py-16 text-center bg-white border border-neutral-200 rounded-xl">
          <p className="text-sm font-medium text-neutral-900">No available products found</p>
          <p className="text-xs text-neutral-500 mt-1">
            Try raising your max price filter or using broader material keywords.
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
