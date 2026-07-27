export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="text-2xl font-semibold tracking-tight">Sotwise</span>
          <p className="mt-1 text-sm text-muted-foreground">
            Import / export logistics
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
