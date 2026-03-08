# File Upload Security

> Version: 1.0.0
> Last Updated: 2026-02-13

## Threats

- **MIME type bypass**: Uploading executable files disguised as images
- **Path traversal**: Filenames containing `../` to write outside upload directory
- **Unrestricted file size**: Memory/disk exhaustion from oversized uploads
- **Unauthenticated upload endpoints**: Anonymous users uploading malicious files
- **Content-Type sniffing**: Browsers interpreting uploads as HTML/JavaScript
- **Storage key prediction**: Guessable file paths enabling unauthorized access

## Safe Patterns

### MIME Type Validation

Validate file type using magic bytes, not just the extension or Content-Type header:

```typescript
// Safe: check actual file content, not just declared type
// Magic bytes for common image formats:
// JPEG: FF D8 FF
// PNG:  89 50 4E 47
// GIF:  47 49 46 38

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// Validate actual MIME type matches declared type
if (!ALLOWED_MIME_TYPES.includes(detectedMimeType)) {
  throw new InvalidFileTypeError();
}
```

### Multer Size Limits

Configure Multer with explicit size limits:

```typescript
// Safe: explicit file size limit
const upload = multer({
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
    files: 1 // Single file at a time
  },
  storage: multer.memoryStorage() // or disk with temp directory
});
```

### UUID-Based Storage Keys

Never use original filenames for storage — generate UUID-based keys:

```typescript
// Safe: UUID storage key prevents path traversal and collisions
const storageKey = `media/${uuidv4()}.${extension}`;
// Original filename stored in metadata only, never used for file path
```

### Serving Files Safely

Set proper headers when serving uploaded content:

```typescript
// Safe: prevent content sniffing and force download for non-images
res.setHeader('X-Content-Type-Options', 'nosniff');
res.setHeader('Content-Disposition', `inline; filename="${sanitizedName}"`);
res.setHeader('Content-Type', detectedMimeType);
// Never serve with Content-Type: text/html
```

### Authenticated Upload Endpoints

All upload endpoints must require authentication:

```typescript
// Safe: upload requires authentication
app.post('/api/v1/media/upload', loggedInOnly, upload.single('file'), handler);
```

## Vulnerable Patterns

### No MIME Validation

```typescript
// VULNERABLE: trusting client-declared Content-Type
const mimeType = req.file.mimetype; // Client can set this to anything
await storage.put(key, file, { contentType: mimeType });
```

### Original Filename in Storage Path

```typescript
// VULNERABLE: path traversal via filename
const path = `uploads/${req.file.originalname}`;
// Attacker: filename = "../../../etc/cron.d/malicious"
```

### No Size Limits

```typescript
// VULNERABLE: no file size restriction
const upload = multer({ storage: multer.memoryStorage() });
// Attacker uploads 10GB file, crashes server
```

### Unauthenticated Upload

```typescript
// VULNERABLE: no auth check on upload endpoint
app.post('/api/v1/upload', upload.single('file'), handler);
```

### Serving Uploaded HTML

```typescript
// VULNERABLE: serving user-uploaded files without nosniff
res.sendFile(uploadedFilePath);
// If file contains HTML with <script>, browser may execute it
```

## Known Codebase Patterns

- Media domain in `src/server/media/` handles all uploads
- Flydrive provides storage abstraction (local filesystem or S3)
- Multer configured for multipart upload handling
- Storage keys use UUID-based naming, not original filenames
- Single media attachment per event currently supported
- S3-compatible storage used in production (`@aws-sdk/client-s3`)
