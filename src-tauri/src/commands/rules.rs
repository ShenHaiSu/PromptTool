// need02 规则 CRUD（03 §6 唯一口径）
// rules 表不新增列；软删除 is_deleted=1；写操作 BEGIN IMMEDIATE 事务。
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::meta::open_active_conn as open_conn;

const RULE_TYPES: &[&str] = &["mutex", "requires", "excludes", "limit", "isolated"];

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuleDto {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub rule_type: String,
    pub source_dimension_id: Option<String>,
    pub source_module_id: Option<String>,
    pub target_dimension_id: Option<String>,
    pub target_module_id: Option<String>,
    pub message: String,
    pub is_enabled: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuleUpsertPayload {
    pub name: String,
    #[serde(rename = "type")]
    pub rule_type: String,
    pub source_dimension_id: Option<String>,
    pub source_module_id: Option<String>,
    pub target_dimension_id: Option<String>,
    pub target_module_id: Option<String>,
    pub message: String,
    pub is_enabled: bool,
}

fn now_ts() -> i64 {
    chrono::Utc::now().timestamp()
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn opt_trim(v: &Option<String>) -> Option<String> {
    match v {
        Some(s) => {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
        None => None,
    }
}

fn row_to_dto(row: &rusqlite::Row) -> rusqlite::Result<RuleDto> {
    let is_enabled: i64 = row.get(8)?;
    Ok(RuleDto {
        id: row.get(0)?,
        name: row.get(1)?,
        rule_type: row.get(2)?,
        source_dimension_id: row.get(3)?,
        source_module_id: row.get(4)?,
        target_dimension_id: row.get(5)?,
        target_module_id: row.get(6)?,
        message: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
        is_enabled: is_enabled != 0,
    })
}

fn dim_alive(conn: &Connection, id: &str) -> Result<bool, String> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM dimensions WHERE id = ?1 AND is_deleted = 0",
            params![id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

fn module_dim(conn: &Connection, mid: &str) -> Result<Option<String>, String> {
    let dim: Option<String> = conn
        .query_row(
            "SELECT dimension_id FROM modules WHERE id = ?1 AND is_deleted = 0",
            params![mid],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(dim)
}

fn validate_payload(conn: &Connection, p: &RuleUpsertPayload) -> Result<(Option<String>, Option<String>, Option<String>, Option<String>), String> {
    if p.name.trim().is_empty() {
        return Err("规则名称不能为空".to_string());
    }
    if p.name.trim().chars().count() > 50 {
        return Err("规则名称不能超过 50 字".to_string());
    }
    if !RULE_TYPES.contains(&p.rule_type.as_str()) {
        return Err("规则类型非法".to_string());
    }
    if p.message.trim().is_empty() {
        return Err("规则消息不能为空".to_string());
    }
    let src_dim = opt_trim(&p.source_dimension_id);
    let src_mod = opt_trim(&p.source_module_id);
    let tgt_dim = opt_trim(&p.target_dimension_id);
    let tgt_mod = opt_trim(&p.target_module_id);

    if p.rule_type != "limit" && p.rule_type != "isolated" && src_dim.is_none() && src_mod.is_none() && tgt_dim.is_none() && tgt_mod.is_none() {
        return Err("mutex/requires/excludes 需至少一侧定位".to_string());
    }

    if let Some(ref d) = src_dim {
        if !dim_alive(conn, d)? {
            return Err("源维度不存在或已删除".to_string());
        }
    }
    if let Some(ref d) = tgt_dim {
        if !dim_alive(conn, d)? {
            return Err("目标维度不存在或已删除".to_string());
        }
    }
    if let Some(ref m) = src_mod {
        match module_dim(conn, m)? {
            None => return Err("源条目不存在或已删除".to_string()),
            Some(actual) => {
                if let Some(ref d) = src_dim {
                    if &actual != d {
                        return Err("源条目不属于源维度".to_string());
                    }
                }
            }
        }
    }
    if let Some(ref m) = tgt_mod {
        match module_dim(conn, m)? {
            None => return Err("目标条目不存在或已删除".to_string()),
            Some(actual) => {
                if let Some(ref d) = tgt_dim {
                    if &actual != d {
                        return Err("目标条目不属于目标维度".to_string());
                    }
                }
            }
        }
    }
    Ok((src_dim, src_mod, tgt_dim, tgt_mod))
}

fn with_immediate_tx<T>(conn: &mut Connection, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
    let result = f(conn);
    match result {
        Ok(out) => {
            conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
            Ok(out)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

#[tauri::command]
pub fn db_list_rules(app: AppHandle, include_disabled: bool) -> Result<Vec<RuleDto>, String> {
    let conn = open_conn(&app)?;
    let sql = if include_disabled {
        "SELECT id, name, type, source_dimension_id, source_module_id, target_dimension_id, target_module_id, message, is_enabled FROM rules WHERE is_deleted = 0 ORDER BY created_at"
    } else {
        "SELECT id, name, type, source_dimension_id, source_module_id, target_dimension_id, target_module_id, message, is_enabled FROM rules WHERE is_deleted = 0 AND is_enabled = 1 ORDER BY created_at"
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_dto)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn db_create_rule(app: AppHandle, payload: RuleUpsertPayload) -> Result<RuleDto, String> {
    let mut conn = open_conn(&app)?;
    let name = payload.name.trim().to_string();
    let message = payload.message.trim().to_string();
    let rule_type = payload.rule_type.clone();
    let is_enabled = payload.is_enabled;
    let (src_dim, src_mod, tgt_dim, tgt_mod) = validate_payload(&conn, &payload)?;
    let id = format!("rule_{}", &new_id().replace('-', "")[..12.min(32)]);
    let ts = now_ts();
    with_immediate_tx(&mut conn, |tx| {
        tx.execute(
            "INSERT INTO rules (id, name, type, source_dimension_id, source_module_id, target_dimension_id, target_module_id, message, is_enabled, created_at, is_deleted) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,0)",
            params![id, name, rule_type, src_dim, src_mod, tgt_dim, tgt_mod, message, if is_enabled { 1 } else { 0 }, ts],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    Ok(RuleDto {
        id,
        name,
        rule_type,
        source_dimension_id: src_dim,
        source_module_id: src_mod,
        target_dimension_id: tgt_dim,
        target_module_id: tgt_mod,
        message,
        is_enabled,
    })
}

#[tauri::command]
pub fn db_update_rule(app: AppHandle, id: String, payload: RuleUpsertPayload) -> Result<RuleDto, String> {
    let mut conn = open_conn(&app)?;
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM rules WHERE id = ?1 AND is_deleted = 0",
            params![id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists == 0 {
        return Err("规则不存在或已删除".to_string());
    }
    let name = payload.name.trim().to_string();
    let message = payload.message.trim().to_string();
    let rule_type = payload.rule_type.clone();
    let is_enabled = payload.is_enabled;
    let (src_dim, src_mod, tgt_dim, tgt_mod) = validate_payload(&conn, &payload)?;
    with_immediate_tx(&mut conn, |tx| {
        tx.execute(
            "UPDATE rules SET name=?1, type=?2, source_dimension_id=?3, source_module_id=?4, target_dimension_id=?5, target_module_id=?6, message=?7, is_enabled=?8 WHERE id=?9",
            params![name, rule_type, src_dim, src_mod, tgt_dim, tgt_mod, message, if is_enabled { 1 } else { 0 }, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    Ok(RuleDto {
        id,
        name,
        rule_type,
        source_dimension_id: src_dim,
        source_module_id: src_mod,
        target_dimension_id: tgt_dim,
        target_module_id: tgt_mod,
        message,
        is_enabled,
    })
}

#[tauri::command]
pub fn db_delete_rule(app: AppHandle, id: String) -> Result<(), String> {
    let mut conn = open_conn(&app)?;
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM rules WHERE id = ?1 AND is_deleted = 0",
            params![id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists == 0 {
        return Err("规则不存在或已删除".to_string());
    }
    with_immediate_tx(&mut conn, |tx| {
        tx.execute("UPDATE rules SET is_deleted = 1 WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    Ok(())
}

#[tauri::command]
pub fn db_toggle_rule(app: AppHandle, id: String, is_enabled: bool) -> Result<RuleDto, String> {
    let mut conn = open_conn(&app)?;
    let mut dto: RuleDto = conn
        .query_row(
            "SELECT id, name, type, source_dimension_id, source_module_id, target_dimension_id, target_module_id, message, is_enabled FROM rules WHERE id = ?1 AND is_deleted = 0",
            params![id],
            row_to_dto,
        )
        .map_err(|_| "规则不存在或已删除".to_string())?;
    with_immediate_tx(&mut conn, |tx| {
        tx.execute(
            "UPDATE rules SET is_enabled = ?1 WHERE id = ?2",
            params![if is_enabled { 1 } else { 0 }, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    dto.is_enabled = is_enabled;
    Ok(dto)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn temp_conn(tag: &str) -> Connection {
        let dir = std::env::temp_dir().join(format!("pmf_rules_test_{}_{}", tag, uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = Connection::open(dir.join("pmf.db")).unwrap();
        conn.execute_batch(include_str!("../../resources/schema.sql")).unwrap();
        conn
    }

    fn seed_dims(conn: &Connection) {
        let ts = chrono::Utc::now().timestamp();
        conn.execute_batch(&format!(
            "INSERT INTO dimensions (id,key,name_cn,name_en,sort_order,is_multi_select,is_enabled,created_at,updated_at,is_deleted) VALUES
             ('dim_top','top','上装','Top',5,0,1,{ts},{ts},0),
             ('dim_outfit','outfit','套装','Outfit',7,0,1,{ts},{ts},0),
             ('dim_shoes','shoes','鞋袜','Shoes',8,0,1,{ts},{ts},0)"
        ))
        .unwrap();
        conn.execute_batch(&format!(
            "INSERT INTO modules (id,dimension_id,content_en,display_name,weight,is_enabled,is_nsfw,usage_count,created_at,updated_at,is_deleted) VALUES
             ('mod_top_01','dim_top','white shirt','白衬衫',1.0,1,0,0,{ts},{ts},0),
             ('mod_shoes_15','dim_shoes','barefoot','赤脚',1.0,1,0,0,{ts},{ts},0)"
        ))
        .unwrap();
    }

    fn payload(name: &str) -> RuleUpsertPayload {
        RuleUpsertPayload {
            name: name.to_string(),
            rule_type: "mutex".to_string(),
            source_dimension_id: Some("dim_outfit".to_string()),
            source_module_id: None,
            target_dimension_id: Some("dim_top".to_string()),
            target_module_id: None,
            message: "已选{source}，{target}将自动忽略".to_string(),
            is_enabled: true,
        }
    }

    fn insert_rule(conn: &Connection, id: &str, p: &RuleUpsertPayload) {
        let ts = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT INTO rules (id,name,type,source_dimension_id,source_module_id,target_dimension_id,target_module_id,message,is_enabled,created_at,is_deleted) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,0)",
            params![id, p.name, p.rule_type, p.source_dimension_id, p.source_module_id, p.target_dimension_id, p.target_module_id, p.message, 1, ts],
        )
        .unwrap();
    }

    fn list_all(conn: &Connection, include_disabled: bool) -> Vec<RuleDto> {
        let sql = if include_disabled {
            "SELECT id, name, type, source_dimension_id, source_module_id, target_dimension_id, target_module_id, message, is_enabled FROM rules WHERE is_deleted = 0 ORDER BY created_at"
        } else {
            "SELECT id, name, type, source_dimension_id, source_module_id, target_dimension_id, target_module_id, message, is_enabled FROM rules WHERE is_deleted = 0 AND is_enabled = 1 ORDER BY created_at"
        };
        conn.prepare(sql)
            .unwrap()
            .query_map([], row_to_dto)
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    }

    #[test]
    fn validate_rejects_bad_type() {
        let conn = temp_conn("type");
        seed_dims(&conn);
        let mut p = payload("t");
        p.rule_type = "nope".to_string();
        let err = validate_payload(&conn, &p).unwrap_err();
        assert_eq!(err, "规则类型非法");
    }

    #[test]
    fn validate_rejects_empty_name_and_message() {
        let conn = temp_conn("empty");
        seed_dims(&conn);
        let p = payload("  ");
        assert_eq!(validate_payload(&conn, &p).unwrap_err(), "规则名称不能为空");
        let mut p2 = payload("ok");
        p2.message = "  ".to_string();
        assert_eq!(validate_payload(&conn, &p2).unwrap_err(), "规则消息不能为空");
    }

    #[test]
    fn validate_rejects_missing_dim_and_cross_dim_module() {
        let conn = temp_conn("dim");
        seed_dims(&conn);
        let mut p = payload("x");
        p.source_dimension_id = Some("dim_missing".to_string());
        assert_eq!(validate_payload(&conn, &p).unwrap_err(), "源维度不存在或已删除");
        // 条目不属于所选维度
        let mut p2 = payload("y");
        p2.source_dimension_id = Some("dim_outfit".to_string());
        p2.source_module_id = Some("mod_top_01".to_string());
        assert_eq!(validate_payload(&conn, &p2).unwrap_err(), "源条目不属于源维度");
    }

    #[test]
    fn soft_deleted_rules_hidden_but_restorable() {
        let conn = temp_conn("softdel");
        seed_dims(&conn);
        let p = payload("soft");
        insert_rule(&conn, "rule_soft", &p);
        assert_eq!(list_all(&conn, true).len(), 1);
        conn.execute("UPDATE rules SET is_deleted = 1 WHERE id = 'rule_soft'", []).unwrap();
        assert_eq!(list_all(&conn, true).len(), 0);
    }

    #[test]
    fn toggle_filters_disabled() {
        let conn = temp_conn("toggle");
        seed_dims(&conn);
        let p = payload("tg");
        insert_rule(&conn, "rule_tg", &p);
        conn.execute("UPDATE rules SET is_enabled = 0 WHERE id = 'rule_tg'", []).unwrap();
        assert_eq!(list_all(&conn, false).len(), 0);
        assert_eq!(list_all(&conn, true).len(), 1);
    }

    #[test]
    fn rule_dto_camel_case_roundtrip() {
        let dto = RuleDto {
            id: "rule_01".to_string(),
            name: "n".to_string(),
            rule_type: "mutex".to_string(),
            source_dimension_id: Some("dim_outfit".to_string()),
            source_module_id: None,
            target_dimension_id: Some("dim_top".to_string()),
            target_module_id: None,
            message: "m".to_string(),
            is_enabled: true,
        };
        let json = serde_json::to_string(&dto).unwrap();
        assert!(json.contains("\"sourceDimensionId\""));
        assert!(json.contains("\"type\":\"mutex\""));
    }
}
