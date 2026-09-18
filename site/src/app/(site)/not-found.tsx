import Link from "next/link";

export const metadata = {
  title: "Page not found - Bhakti Nam Jap",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <div className="wrap">
      <div className="empty">
        <p className="om" aria-hidden="true">
          ॐ
        </p>
        <h1 className="empty-title">Page not found</h1>
        <p>This page could not be found.</p>
        <Link className="btn" href="/">
          Open the Nam Jap Counter
        </Link>
      </div>
    </div>
  );
}
