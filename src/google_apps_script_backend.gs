/**
 * Google Apps Script backend for GLR dashboard sync.
 *
 * Receives payload from your app:
 * {
 *   deviceId: "...",
 *   sentAt: "...",
 *   queue: [{ id, op, payload, at }, ...],
 *   snapshot: { sales: [], inventory: [], audit: [] }
 * }
 *
 * Supported operations:
 * - upsert_sale
 * - delete_sale
 * - upsert_inventory
 * - delete_inventory
 * - append_audit
 */

const SHEET_SALES = "Sales";
const SHEET_INVENTORY = "Inventory";
const SHEET_AUDIT = "AuditLog";
const SHEET_SYNC_LOG = "SyncLog";

const SALES_HEADERS = [
  "ID",
  "DATE",
  "TIME",
  "DATETIME",
  "CUSTOMER",
  "PRODUCT_INDEX",
  "PRODUCT_NAME",
  "SELLING_PRICE",
  "QTY",
  "TOTAL_PRICE",
  "UNIT_COST",
  "TOTAL_COST",
  "PROFIT",
  "PAID",
  "BALANCE",
  "PAYMENT_TYPE",
  "STATUS",
  "CREATED_AT",
  "UPDATED_AT",
  "DEVICE_ID"
];

const INVENTORY_HEADERS = [
  "ID",
  "PRODUCT_NAME",
  "UNIT_COST",
  "UPDATED_AT",
  "DEVICE_ID"
];

const AUDIT_HEADERS = [
  "AUDIT_ID",
  "SOURCE_ID",
  "AUDIT_TYPE",
  "ENTITY_TYPE",
  "CUSTOMER",
  "PRODUCT_NAME",
  "PRODUCT_ID",
  "QTY",
  "TOTAL_PRICE",
  "PAID",
  "BALANCE",
  "REASON",
  "NOTES",
  "SALE_DATE",
  "SALE_TIME",
  "ARCHIVED_AT",
  "ARCHIVED_AT_DISPLAY",
  "DEVICE_ID"
];

const SYNC_LOG_HEADERS = [
  "RECEIVED_AT",
  "DEVICE_ID",
  "SENT_AT",
  "QUEUE_COUNT",
  "STATUS",
  "DETAILS"
];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const payload = parseRequest_(e);
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const salesSheet = ensureSheet_(ss, SHEET_SALES, SALES_HEADERS);
    const inventorySheet = ensureSheet_(ss, SHEET_INVENTORY, INVENTORY_HEADERS);
    const auditSheet = ensureSheet_(ss, SHEET_AUDIT, AUDIT_HEADERS);
    const syncLogSheet = ensureSheet_(ss, SHEET_SYNC_LOG, SYNC_LOG_HEADERS);

    const queue = Array.isArray(payload.queue) ? payload.queue : [];
    const deviceId = String(payload.deviceId || "");
    const nowIso = new Date().toISOString();

    for (let i = 0; i < queue.length; i += 1) {
      const item = queue[i] || {};
      const op = String(item.op || "");
      const opPayload = item.payload || {};
      applyQueueOp_(op, opPayload, {
        ss,
        salesSheet,
        inventorySheet,
        auditSheet,
        deviceId,
        nowIso
      });
    }

    // Optional safety upsert from snapshot (does not delete rows).
    const snapshot = payload.snapshot || {};
    upsertSalesSnapshot_(salesSheet, snapshot.sales, deviceId, nowIso);
    upsertInventorySnapshot_(inventorySheet, snapshot.inventory, deviceId, nowIso);
    upsertAuditSnapshot_(auditSheet, snapshot.audit, deviceId);

    appendSyncLog_(syncLogSheet, {
      receivedAt: nowIso,
      deviceId: deviceId,
      sentAt: String(payload.sentAt || ""),
      queueCount: queue.length,
      status: "success",
      details: "Processed queue and snapshot"
    });

    return jsonResponse_({ ok: true, processed: queue.length });
  } catch (err) {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const syncLogSheet = ensureSheet_(ss, SHEET_SYNC_LOG, SYNC_LOG_HEADERS);
      appendSyncLog_(syncLogSheet, {
        receivedAt: new Date().toISOString(),
        deviceId: "",
        sentAt: "",
        queueCount: 0,
        status: "error",
        details: String(err && err.message ? err.message : err)
      });
    } catch (ignore) {}
    return jsonResponse_({
      ok: false,
      error: String(err && err.message ? err.message : err)
    });
  } finally {
    lock.releaseLock();
  }
}

function parseRequest_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error("Missing POST body");
  }
  const raw = e.postData.contents;
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid JSON payload");
  }
  return parsed;
}

function applyQueueOp_(op, payload, ctx) {
  switch (op) {
    case "upsert_sale":
      upsertSale_(ctx.salesSheet, payload, ctx.deviceId, ctx.nowIso);
      break;
    case "delete_sale":
      deleteById_(ctx.salesSheet, String(payload.id || ""), SALES_HEADERS, "ID");
      break;
    case "upsert_inventory":
      upsertInventory_(ctx.inventorySheet, payload, ctx.deviceId, ctx.nowIso);
      break;
    case "delete_inventory":
      deleteById_(ctx.inventorySheet, String(payload.id || ""), INVENTORY_HEADERS, "ID");
      break;
    case "append_audit":
      appendAudit_(ctx.auditSheet, payload, ctx.deviceId);
      break;
    case "reset_data":
      resetAllSheets_(ctx.ss);
      break;
    default:
      // Ignore unknown operation types.
      break;
  }
}

function upsertSalesSnapshot_(sheet, sales, deviceId, nowIso) {
  if (!Array.isArray(sales)) return;
  for (let i = 0; i < sales.length; i += 1) {
    upsertSale_(sheet, sales[i], deviceId, nowIso);
  }
}

function upsertInventorySnapshot_(sheet, inventory, deviceId, nowIso) {
  if (!Array.isArray(inventory)) return;
  for (let i = 0; i < inventory.length; i += 1) {
    upsertInventory_(sheet, inventory[i], deviceId, nowIso);
  }
}

function upsertAuditSnapshot_(sheet, auditEntries, deviceId) {
  if (!Array.isArray(auditEntries)) return;
  for (let i = 0; i < auditEntries.length; i += 1) {
    appendAudit_(sheet, auditEntries[i], deviceId);
  }
}

function upsertSale_(sheet, sale, deviceId, nowIso) {
  if (!sale || !sale.id) return;
  const rowObj = {
    ID: String(sale.id || ""),
    DATE: String(sale.date || ""),
    TIME: String(sale.time || ""),
    DATETIME: String(sale.datetime || ""),
    CUSTOMER: String(sale.customer || ""),
    PRODUCT_INDEX: num_(sale.productIndex != null ? sale.productIndex : sale.productId),
    PRODUCT_NAME: String(sale.productName || ""),
    SELLING_PRICE: num_(sale.sellingPrice),
    QTY: num_(sale.qty),
    TOTAL_PRICE: num_(sale.totalPrice),
    UNIT_COST: num_(sale.unitCost),
    TOTAL_COST: num_(sale.totalCost),
    PROFIT: num_(sale.profit),
    PAID: num_(sale.paid),
    BALANCE: num_(sale.balance),
    PAYMENT_TYPE: String(sale.paymentType || ""),
    STATUS: String(sale.status || ""),
    CREATED_AT: String(sale.createdAt || ""),
    UPDATED_AT: nowIso,
    DEVICE_ID: String(deviceId || "")
  };
  upsertByKey_(sheet, SALES_HEADERS, "ID", rowObj);
}

function upsertInventory_(sheet, item, deviceId, nowIso) {
  if (!item || !item.id) return;
  const rowObj = {
    ID: String(item.id || ""),
    PRODUCT_NAME: String(item.name || item.productName || ""),
    UNIT_COST: num_(item.cost != null ? item.cost : item.unitCost),
    UPDATED_AT: nowIso,
    DEVICE_ID: String(deviceId || "")
  };
  upsertByKey_(sheet, INVENTORY_HEADERS, "ID", rowObj);
}

function appendAudit_(sheet, entry, deviceId) {
  if (!entry || typeof entry !== "object") return;
  const auditId = String(entry.auditId || buildAuditId_(entry));
  if (!auditId) return;

  const rowObj = {
    AUDIT_ID: auditId,
    SOURCE_ID: String(entry.id || ""),
    AUDIT_TYPE: String(entry.auditType || ""),
    ENTITY_TYPE: String(entry.auditEntityType || ""),
    CUSTOMER: String(entry.customer || ""),
    PRODUCT_NAME: String(entry.productName || entry.removedProductName || ""),
    PRODUCT_ID: String(entry.productId || entry.removedProductId || ""),
    QTY: num_(entry.qty),
    TOTAL_PRICE: num_(entry.totalPrice),
    PAID: num_(entry.paid),
    BALANCE: num_(entry.balance),
    REASON: String(entry.auditReason || ""),
    NOTES: String(entry.auditNotes || ""),
    SALE_DATE: String(entry.date || ""),
    SALE_TIME: String(entry.time || ""),
    ARCHIVED_AT: String(entry.auditDate || ""),
    ARCHIVED_AT_DISPLAY: String(entry.auditDateDisplay || ""),
    DEVICE_ID: String(deviceId || "")
  };
  upsertByKey_(sheet, AUDIT_HEADERS, "AUDIT_ID", rowObj);
}

function buildAuditId_(entry) {
  const t = String(entry.auditDate || new Date().toISOString());
  const id = String(entry.id || "NA");
  const type = String(entry.auditType || "audit");
  return [type, id, t].join("|");
}

function upsertByKey_(sheet, headers, keyHeader, rowObj) {
  const keyCol = headers.indexOf(keyHeader) + 1;
  if (keyCol <= 0) throw new Error("Key header not found: " + keyHeader);

  const key = String(rowObj[keyHeader] || "");
  if (!key) return;

  const lastRow = sheet.getLastRow();
  let targetRow = -1;
  if (lastRow > 1) {
    const keyValues = sheet.getRange(2, keyCol, lastRow - 1, 1).getValues();
    for (let i = 0; i < keyValues.length; i += 1) {
      if (String(keyValues[i][0]) === key) {
        targetRow = i + 2;
        break;
      }
    }
  }

  const rowArr = headers.map(function (h) {
    return rowObj[h] != null ? rowObj[h] : "";
  });

  if (targetRow === -1) {
    sheet.appendRow(rowArr);
  } else {
    sheet.getRange(targetRow, 1, 1, headers.length).setValues([rowArr]);
  }
}

function deleteById_(sheet, id, headers, keyHeader) {
  if (!id) return;
  const keyCol = headers.indexOf(keyHeader) + 1;
  if (keyCol <= 0) return;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;
  const keyValues = sheet.getRange(2, keyCol, lastRow - 1, 1).getValues();
  for (let i = keyValues.length - 1; i >= 0; i -= 1) {
    if (String(keyValues[i][0]) === id) {
      sheet.deleteRow(i + 2);
    }
  }
}

function resetAllSheets_(ss) {
  const salesSheet = ensureSheet_(ss, SHEET_SALES, SALES_HEADERS);
  const inventorySheet = ensureSheet_(ss, SHEET_INVENTORY, INVENTORY_HEADERS);
  const auditSheet = ensureSheet_(ss, SHEET_AUDIT, AUDIT_HEADERS);
  const syncLogSheet = ensureSheet_(ss, SHEET_SYNC_LOG, SYNC_LOG_HEADERS);
  clearSheetRows_(salesSheet);
  clearSheetRows_(inventorySheet);
  clearSheetRows_(auditSheet);
  clearSheetRows_(syncLogSheet);
}

function clearSheetRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 1)).clearContent();
  }
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const needHeader = firstRow.join("") !== headers.join("");
  if (needHeader) {
    sheet.clear();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function appendSyncLog_(sheet, row) {
  sheet.appendRow([
    row.receivedAt || "",
    row.deviceId || "",
    row.sentAt || "",
    row.queueCount || 0,
    row.status || "",
    row.details || ""
  ]);
}

function num_(v) {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
