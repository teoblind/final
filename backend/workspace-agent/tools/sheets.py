"""Google Sheets creation and modification tools."""

from typing import Optional
from google_auth import sheets_service, drive_service
from tools.drive import move_to_folder, share_file
from tools.comments import add_comment


def _apply_formatting(
    spreadsheet_id: str, sheet_id: int, formatting: dict, tenant_id: str
) -> list[dict]:
    """Build batchUpdate requests for sheet formatting."""
    requests = []

    # Bold headers
    if formatting.get("header_bold"):
        requests.append({
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": 1,
                },
                "cell": {
                    "userEnteredFormat": {
                        "textFormat": {"bold": True},
                        "backgroundColor": {
                            "red": 0.93, "green": 0.93, "blue": 0.93
                        },
                    }
                },
                "fields": "userEnteredFormat(textFormat,backgroundColor)",
            }
        })

    # Currency columns
    for col in formatting.get("currency_columns", []):
        requests.append({
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startColumnIndex": col,
                    "endColumnIndex": col + 1,
                    "startRowIndex": 1,
                },
                "cell": {
                    "userEnteredFormat": {
                        "numberFormat": {"type": "CURRENCY", "pattern": "$#,##0.00"}
                    }
                },
                "fields": "userEnteredFormat.numberFormat",
            }
        })

    # Percentage columns
    for col in formatting.get("percentage_columns", []):
        requests.append({
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startColumnIndex": col,
                    "endColumnIndex": col + 1,
                    "startRowIndex": 1,
                },
                "cell": {
                    "userEnteredFormat": {
                        "numberFormat": {"type": "PERCENT", "pattern": "0.0%"}
                    }
                },
                "fields": "userEnteredFormat.numberFormat",
            }
        })

    # Conditional formatting
    for rule in formatting.get("conditional_formatting", []):
        col = rule["column"]
        requests.append({
            "addConditionalFormatRule": {
                "rule": {
                    "ranges": [{
                        "sheetId": sheet_id,
                        "startColumnIndex": col,
                        "endColumnIndex": col + 1,
                        "startRowIndex": 1,
                    }],
                    "booleanRule": {
                        "condition": {
                            "type": "NUMBER_LESS_THAN_EQ"
                            if rule.get("rule") == "less_than"
                            else "NUMBER_GREATER_THAN_EQ",
                            "values": [{"userEnteredValue": str(rule["value"])}],
                        },
                        "format": {
                            "backgroundColor": _hex_to_rgb(rule.get("color", "#fbeae8"))
                        },
                    },
                },
                "index": 0,
            }
        })

    return requests


def _hex_to_rgb(hex_color: str) -> dict:
    """Convert hex color to Sheets API RGB dict."""
    h = hex_color.lstrip("#")
    return {
        "red": int(h[0:2], 16) / 255,
        "green": int(h[2:4], 16) / 255,
        "blue": int(h[4:6], 16) / 255,
    }


def create_sheet(
    title: str,
    folder: str,
    sheets: list[dict],
    tenant_id: str,
    comment: Optional[str] = None,
    tag_users: Optional[list[str]] = None,
) -> dict:
    """Create a new Google Sheet with tabs, data, and formatting.

    Returns: { file_id, url }
    """
    svc = sheets_service(tenant_id)

    # Build sheet properties
    sheet_props = []
    for i, sheet_def in enumerate(sheets):
        sheet_props.append({
            "properties": {
                "sheetId": i,
                "title": sheet_def.get("name", f"Sheet{i + 1}"),
            }
        })

    spreadsheet = svc.spreadsheets().create(
        body={
            "properties": {"title": title},
            "sheets": sheet_props,
        }
    ).execute()
    spreadsheet_id = spreadsheet["spreadsheetId"]

    # Populate data and apply formatting per sheet
    for i, sheet_def in enumerate(sheets):
        tab_name = sheet_def.get("name", f"Sheet{i + 1}")
        headers = sheet_def.get("headers", [])
        rows = sheet_def.get("rows", [])

        # Write headers + rows
        values = []
        if headers:
            values.append(headers)
        values.extend(rows)

        if values:
            svc.spreadsheets().values().update(
                spreadsheetId=spreadsheet_id,
                range=f"'{tab_name}'!A1",
                valueInputOption="USER_ENTERED",
                body={"values": values},
            ).execute()

        # Apply formatting
        formatting = sheet_def.get("formatting", {})
        if formatting:
            fmt_requests = _apply_formatting(spreadsheet_id, i, formatting, tenant_id)
            if fmt_requests:
                svc.spreadsheets().batchUpdate(
                    spreadsheetId=spreadsheet_id,
                    body={"requests": fmt_requests},
                ).execute()

    # Share with anyone (link) so tenant users can access
    share_file(spreadsheet_id, tenant_id)

    # Move to folder
    if folder:
        move_to_folder(spreadsheet_id, folder, tenant_id)

    if comment:
        add_comment(spreadsheet_id, comment, tenant_id, tag_users=tag_users)

    url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit"
    return {"file_id": spreadsheet_id, "url": url}


def modify_sheet(
    file_id: str,
    changes: list[dict],
    tenant_id: str,
    comment: Optional[str] = None,
    tag_users: Optional[list[str]] = None,
) -> dict:
    """Modify an existing Google Sheet.

    Each change has: sheet_name, action (append_rows | update_cells | add_sheet |
    delete_rows | add_chart | update_formula), range, data.
    """
    svc = sheets_service(tenant_id)

    for change in changes:
        action = change.get("action", "")
        sheet_name = change.get("sheet_name", "Sheet1")
        data = change.get("data", {})
        cell_range = change.get("range", "")

        if action == "append_rows":
            rows = data if isinstance(data, list) else data.get("rows", [])
            svc.spreadsheets().values().append(
                spreadsheetId=file_id,
                range=f"'{sheet_name}'!A1",
                valueInputOption="USER_ENTERED",
                body={"values": rows},
            ).execute()

        elif action == "update_cells" and cell_range:
            values = data if isinstance(data, list) else data.get("values", [])
            svc.spreadsheets().values().update(
                spreadsheetId=file_id,
                range=f"'{sheet_name}'!{cell_range}",
                valueInputOption="USER_ENTERED",
                body={"values": values},
            ).execute()

        elif action == "add_sheet":
            svc.spreadsheets().batchUpdate(
                spreadsheetId=file_id,
                body={
                    "requests": [{
                        "addSheet": {
                            "properties": {"title": data.get("name", sheet_name)}
                        }
                    }]
                },
            ).execute()

        elif action == "delete_rows":
            # data should have start_row and end_row
            sheet_meta = svc.spreadsheets().get(spreadsheetId=file_id).execute()
            sheet_id = None
            for s in sheet_meta.get("sheets", []):
                if s["properties"]["title"] == sheet_name:
                    sheet_id = s["properties"]["sheetId"]
                    break
            if sheet_id is not None:
                svc.spreadsheets().batchUpdate(
                    spreadsheetId=file_id,
                    body={
                        "requests": [{
                            "deleteDimension": {
                                "range": {
                                    "sheetId": sheet_id,
                                    "dimension": "ROWS",
                                    "startIndex": data.get("start_row", 0),
                                    "endIndex": data.get("end_row", 1),
                                }
                            }
                        }]
                    },
                ).execute()

    if comment:
        add_comment(file_id, comment, tenant_id, tag_users=tag_users)

    return {"file_id": file_id, "status": "modified"}
