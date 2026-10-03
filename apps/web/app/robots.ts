// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import type { MetadataRoute } from 'next';
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } };
}
