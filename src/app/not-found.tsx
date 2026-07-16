import { Button } from "@/components/ui";

export default function NotFound() {
  return (
    <section className="container-x flex min-h-[60vh] flex-col items-center justify-center py-24 text-center">
      <span className="font-mono text-h5 text-sage-600">404</span>
      <h1 className="mt-3 text-h2 text-strong">Page not found</h1>
      <p className="mt-3 max-w-md text-body">
        The page you’re looking for doesn’t exist. Explore our published
        product catalog instead.
      </p>
      <div className="mt-8 flex gap-4">
        <Button href="/products" variant="primary">
          Browse products
        </Button>
        <Button href="/" variant="outline">
          Back home
        </Button>
      </div>
    </section>
  );
}
