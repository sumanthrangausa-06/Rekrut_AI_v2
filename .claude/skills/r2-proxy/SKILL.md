# R2 Proxy - File Storage

Upload and manage files using Polsia's R2 storage proxy. Files are stored in Cloudflare R2 with automatic CDN delivery.

## Base URL

```
https://polsia.com/api/proxy/r2
```

## Authentication

All requests require the `POLSIA_API_KEY` header:

```javascript
headers: {
  'Authorization': `Bearer ${process.env.POLSIA_API_KEY}`
}
```

## Upload a File

**Endpoint:** `POST /upload`

**Content-Type:** `multipart/form-data`

### Node.js with node-fetch (Recommended)

**IMPORTANT:** Use `node-fetch` instead of Node's native `fetch` for file uploads. Native fetch has compatibility issues with form-data streams that cause "Unexpected end of form" errors.

```javascript
const fetch = require('node-fetch');  // IMPORTANT: Use node-fetch, not native fetch
const FormData = require('form-data');

async function uploadToR2(fileBuffer, filename, mimeType) {
  const formData = new FormData();
  formData.append('file', fileBuffer, {
    filename,
    contentType: mimeType
  });

  const response = await fetch('https://polsia.com/api/proxy/r2/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.POLSIA_API_KEY}`,
      ...formData.getHeaders()  // CRITICAL: includes Content-Type with boundary
    },
    body: formData
  });

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error?.message || 'Upload failed');
  }
  return result.file.url;
}
```

### With Express + Multer

```javascript
const fetch = require('node-fetch');  // IMPORTANT: Use node-fetch
const multer = require('multer');
const FormData = require('form-data');

const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/products', upload.single('image'), async (req, res) => {
  let imageUrl = null;

  if (req.file) {
    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });

    const uploadRes = await fetch('https://polsia.com/api/proxy/r2/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.POLSIA_API_KEY}`,
        ...formData.getHeaders()
      },
      body: formData
    });

    const result = await uploadRes.json();
    if (result.success) {
      imageUrl = result.file.url;
    }
  }

  // Save product with imageUrl...
});
```

### Common Mistakes

```javascript
// WRONG #1 - Using native fetch (causes "Unexpected end of form" error)
const response = await fetch(url, { ... });  // Native fetch breaks form-data streams

// CORRECT - Use node-fetch
const fetch = require('node-fetch');
const response = await fetch(url, { ... });

// WRONG #2 - Missing formData.getHeaders()
const response = await fetch(url, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'multipart/form-data'  // NO! Missing boundary
  },
  body: formData
});

// CORRECT - Use formData.getHeaders()
const response = await fetch(url, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    ...formData.getHeaders()  // Includes Content-Type WITH boundary
  },
  body: formData
});
```

## Response Format

```json
{
  "success": true,
  "file": {
    "id": "uuid",
    "key": "company_123/abc123_image.jpg",
    "url": "https://cdn.polsia.com/company_123/abc123_image.jpg",
    "filename": "image.jpg",
    "mime_type": "image/jpeg",
    "size": 102400,
    "created_at": "2025-01-08T12:00:00Z"
  }
}
```

## List Files

```javascript
const response = await fetch('https://polsia.com/api/proxy/r2/files?limit=50', {
  headers: { 'Authorization': `Bearer ${process.env.POLSIA_API_KEY}` }
});
const { files, pagination } = await response.json();
```

## Delete File

```javascript
await fetch(`https://polsia.com/api/proxy/r2/files/${fileKey}`, {
  method: 'DELETE',
  headers: { 'Authorization': `Bearer ${process.env.POLSIA_API_KEY}` }
});
```

## Allowed File Types

- **Images:** jpeg, png, gif, webp
- **Videos:** mp4, webm, mov, avi, mpeg
- **Audio:** mp3, wav, ogg, m4a, aac, flac
- **Documents:** pdf, docx, pptx, xlsx, txt, csv

## Size Limits

- Images: 20MB
- Videos: 1GB
- Audio: 500MB
- Documents: 50MB

## Dependencies

Add to package.json:
```json
"node-fetch": "^2.7.0",
"form-data": "^4.0.0",
"multer": "^1.4.5-lts.1"
```

**Note:** Use `node-fetch` v2.x (not v3.x) for CommonJS compatibility.
