# Local backup and restore

The application keeps its data in the repository-local `.infinite-board-data` directory by default. Both local launchers, backup, and restore resolve the same directory:

- `infinite-board.sqlite` is the local database.
- `assets` contains content-addressed image and other asset files.
- `backups` contains generated backup sets and restore points.

Run the application from PowerShell with:

```powershell
.\scripts\start-local.ps1
```

The launcher checks the required Node and pnpm versions, both local ports, and application data directories. Before it starts the API it runs and records pending SQLite migrations; it then waits for API health before opening the web app. It starts only loopback services.

Create a backup with:

```powershell
.\scripts\backup.ps1
```

Each backup set contains a SQLite copy made through SQLite's backup API, an asset-directory snapshot, and one complete `.iboard` archive per Project. The `.iboard` archives include `references.json`, so the backup preserves the reference graph rather than a parent/child tree.

After a successful backup, the local retention policy keeps the latest seven distinct daily backup sets and one set for each of the latest four older weeks. Directories without a valid backup manifest are never removed automatically; manage recovered or manually copied backups yourself.

`-DataDirectory` is an exact application data directory. When it is omitted, every lifecycle script first honors `INFINITE_BOARD_DATA_DIR` and then falls back to the repository-local directory, so a service deployment and its backup job cannot silently diverge. The legacy `-LocalAppDataBase` parameter remains available and resolves to its `InfiniteBoard` child; do not pass it together with `-DataDirectory`. To choose a data or destination directory, pass explicit PowerShell parameters:

```powershell
.\scripts\backup.ps1 -DataDirectory 'D:\InfiniteBoardData' -BackupDirectory 'E:\BoardBackups'
```

Restore requires the local API to be stopped. This prevents the database from being overwritten while it has an active connection or WAL. Then provide the exact backup directory printed by `backup.ps1`:

```powershell
.\scripts\restore.ps1 -BackupDirectory 'E:\BoardBackups\backup-2026-07-23T08-00-00-000Z-xxxxxx'
```

Before replacing anything, restore creates an automatic restore point under `backups\restore-points`. It restores the database and assets together, then checks SQLite integrity and foreign keys, the project reference graph, and the one-to-one reference-row/reference-shape mapping. A failed validation restores the previous database and assets. After a successful restore, start the app normally and reopen Boards from the project home; browser tabs, history, selections, edit leases, undo/redo receipts, and unsaved drafts are intentionally not restored.

Do not edit the backup's SQLite file, asset files, or `.iboard` archives in place. Keep backup directories outside the working repository and never place OAuth credentials or `.env.local` in a backup you share.
