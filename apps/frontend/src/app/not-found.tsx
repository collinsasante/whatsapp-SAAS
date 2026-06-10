export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900">404</h1>
        <p className="text-gray-500 mt-2">Page not found</p>
        <a href="/" className="mt-4 inline-block text-teal-600 hover:text-teal-700 text-sm font-medium">
          Go home
        </a>
      </div>
    </div>
  );
}
