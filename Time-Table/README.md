# RPSIT Timetable Studio

This is a browser-based timetable generator for R P Sarathy Institute of Technology.

## Run

The application now uses a small Flask server that hosts the existing browser UI
and provides the fixed-credential login and persistent timetable history.

```powershell
pip install flask
python server.py
```

Open `http://127.0.0.1:8000` and sign in with the fixed credentials:

- Username: `Rpsit_admin`
- Password: `rpsit123`

The password is verified on the server against a PBKDF2-SHA256 hash; it is never
stored or compared client-side when the API is available. Saved timetables are
persisted in SQLite (`backend/generated/timetable_history.db`) and survive
logout, refresh, and re-login.

Configuration (all optional):

- `RPSIT_ADMIN_USER` / `RPSIT_ADMIN_PASSWORD` — override the fixed credentials.
- `RPSIT_SECRET_KEY` — session signing key (generated and persisted if unset).
- `RPSIT_COOKIE_SECURE=1` — mark the session cookie `Secure` for HTTPS deployments.
- `RPSIT_DB_PATH` — alternate SQLite file location.
- `PORT` — server port (defaults to `8000`).

> The previous static workflow (`python -m http.server`, Live Server, or any
> static host) also works: when the Flask API cannot be reached the browser
> falls back to the same fixed credentials and keeps saved timetables in local
> browser storage. Running the Flask server keeps history in SQLite and shares
> it across browsers/devices.

Upload an `.xlsx` workbook. The app supports the canonical fields `Teacher Name`,
`Subject Name`, `Subject Code`, `Class Name`, and `Periods Required`, plus the
supplied section-marker workbook format where a class label such as `AIDS`
precedes the subject table.

Click `Generate`, select a class, and use `Export PDF`. The export uses browser
print-to-PDF so the native PDF dialog controls the final save location.
`Save Timetable` and `Export PDF` are independent actions: saving creates a
history record, exporting only downloads the PDF. The `Previously Generated
Timetables` panel on the dashboard lists saved records and lets you reopen or
export them without rerunning the scheduler. The live UI remains logo-free; the
RPSIT logo appears only on the print document.


Before generating, configure fixed periods in the subject-classification panel. Labs use one manually selected continuous block and can be assigned before or after lunch. Placement and Library subjects can use either one continuous block or individually selected periods on different days. These reservations are preserved during regeneration, and remaining theory subjects are scheduled around them. The timetable grid's manual-edit mode provides a second way to adjust the same fixed reservations.

## Tests

```powershell
npm test
```
