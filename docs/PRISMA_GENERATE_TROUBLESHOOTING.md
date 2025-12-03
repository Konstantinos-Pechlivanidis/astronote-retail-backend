# Prisma Generate Troubleshooting

## Issue: EPERM Error on Windows

**Error**: `EPERM: operation not permitted, rename '...query_engine-windows.dll.node.tmp...' -> '...query_engine-windows.dll.node'`

**Cause**: The Prisma client file is locked by a running Node.js process (API server, worker, or development server).

## Solutions

### Solution 1: Stop Running Processes (Recommended)

1. **Stop the API server** (if running):
   ```powershell
   # Find and stop the process
   Get-Process node | Where-Object {$_.Path -like "*sms-marketing-backend*"} | Stop-Process -Force
   ```

2. **Or stop all Node.js processes** (use with caution):
   ```powershell
   Stop-Process -Name node -Force
   ```

3. **Then generate**:
   ```powershell
   npm run prisma:generate
   ```

### Solution 2: Clean and Regenerate

1. **Delete the .prisma folder**:
   ```powershell
   Remove-Item -Path "node_modules\.prisma" -Recurse -Force
   ```

2. **Generate**:
   ```powershell
   npm run prisma:generate
   ```

### Solution 3: Generate After Restart

The Prisma client will automatically regenerate when:
- You restart your development server
- The application detects schema changes
- You run `npm install` (if Prisma is configured to generate on install)

## Verification

After generating, verify the client is up to date:

```powershell
npx prisma --version
```

## Prevention

To avoid this issue in the future:
1. Stop development servers before running `prisma generate`
2. Use `prisma generate` in CI/CD pipelines (where processes aren't running)
3. Consider using `prisma generate` in a postinstall script (with proper error handling)

## Note

This is a Windows-specific file locking issue. On Linux/Mac, the same command typically works even with running processes (though it's still recommended to stop processes first).

