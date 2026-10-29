//! 明示されたライブラリ／フォルダー内からMarkdownを選ぶ。本文は既存の文書取得経路へ渡す。
use super::*;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharePointEntry { pub name: String, pub uri: String, pub folder: bool }
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharePointListing { pub uri: String, pub parent_uri: Option<String>, pub entries: Vec<SharePointEntry> }
#[derive(Deserialize)]
struct ChildrenPage {
    value: Vec<Child>,
    #[serde(rename="@odata.nextLink")] next: Option<String>,
}
#[derive(Deserialize)]
struct Child { name: String, folder: Option<serde_json::Value> }

fn listing_drive<'a>(drives: &'a [DriveResponse], source: &SpmdUri) -> Result<(&'a DriveResponse,String),SharePointError> {
    for drive in drives {
        let Ok(url) = Url::parse(&drive.web_url) else {continue};
        if url.scheme()=="https" && url.host_str().is_some_and(|host|host.eq_ignore_ascii_case(&source.tenant_host)) &&
            decoded_url_path_segments(&url).ok().is_some_and(|segments| segments.iter().map(|part|part.to_lowercase()).eq(path_segments(&source.server_relative_path).iter().map(|part|part.to_lowercase()))) {
            return Ok((drive,String::new()));
        }
    }
    select_drive_path(drives,&source.tenant_host,&source.server_relative_path)
}
fn children_url(root: &str, drive: &str, item_path: &str) -> String {
    if item_path.is_empty() { format!("{root}/drives/{}/root/children",encode_segment(drive)) }
    else { format!("{root}/drives/{}/root:{}:/children",encode_segment(drive),encode_graph_path(item_path)) }
}
fn checked_next(current: &str, next: &str) -> Result<String,SharePointError> {
    let expected=Url::parse(current).map_err(|_|SpmdUriError::Invalid)?;
    let next=Url::parse(next).map_err(|_|SpmdUriError::Invalid)?;
    if expected.scheme()!=next.scheme() || expected.host_str()!=next.host_str() || expected.port_or_known_default()!=next.port_or_known_default() ||
        expected.path()!=next.path() || !next.username().is_empty() || next.password().is_some() || next.fragment().is_some() {
        return Err(SharePointError::Graph("一覧のページ送り先が一致しません。".into()));
    }
    Ok(next.to_string())
}
fn listing_entry(source: &SpmdUri, child: Child) -> Result<Option<SharePointEntry>,SharePointError> {
    if child.name.is_empty() || child.name=="." || child.name==".." || child.name.contains(['/', '\\']) || child.name.chars().any(char::is_control) {
        return Err(SpmdUriError::UnsafePath.into());
    }
    let folder=child.folder.is_some();
    if !folder && !child.name.to_ascii_lowercase().ends_with(".md") && !child.name.to_ascii_lowercase().ends_with(".markdown") {return Ok(None)}
    let uri=format!("{}/{}",source.canonical_uri.trim_end_matches('/'),encode_segment(&child.name));
    parse_spmd_location(&uri)?;
    Ok(Some(SharePointEntry {name:child.name,uri,folder}))
}
impl SharePointClient {
    pub async fn list_folder<F>(&self, value: &str, config: &SharePointAuthConfig, show_prompt:F) -> Result<SharePointListing,SharePointError>
    where F:FnOnce(DeviceCodePrompt)->Result<(),SharePointError> {
        let source=parse_spmd_location(value)?;
        let token=self.access_token(config,show_prompt).await?;
        self.list_folder_with_token(&source,GRAPH_ROOT,&token).await
    }
    async fn list_folder_with_token(&self,source:&SpmdUri,root:&str,token:&str)->Result<SharePointListing,SharePointError> {
        let site_url=format!("{root}/sites/{}:{}",source.tenant_host,encode_graph_path(&source.site_path));
        let site:SiteResponse=self.graph_json(&site_url,token).await?;
        let drives_url=format!("{root}/sites/{}/drives",encode_segment(&site.id));
        let drives:DrivesResponse=self.graph_json(&drives_url,token).await?;
        let (drive,item_path)=listing_drive(&drives.value,source)?;
        let first=children_url(root,&drive.id,&item_path);
        let mut next=Some(first.clone()); let mut entries=Vec::new(); let mut pages=0; let mut count=0;
        let mut seen=std::collections::HashSet::new();
        while let Some(url)=next {
            pages+=1;
            if pages>20 || !seen.insert(url.clone()) {return Err(SharePointError::Graph("一覧のページ数が上限を超えたか、同じページが繰り返されました。".into()))}
            // サイズ境界を設け、巨大なJSONを無制限に展開しない。
            let bytes=self.graph_bytes_limited(&url,token,2*1024*1024).await?;
            let page:ChildrenPage=serde_json::from_slice(&bytes).map_err(|_|SharePointError::Graph("一覧応答の形式が正しくありません。".into()))?;
            count+=page.value.len(); if count>2000 {return Err(SharePointError::Graph("一覧は2,000項目までです。より小さいフォルダーを指定してください。".into()))}
            for child in page.value {if let Some(entry)=listing_entry(source,child)? {entries.push(entry)}}
            next=page.next.as_deref().map(|url|checked_next(&first,url)).transpose()?;
        }
        entries.sort_by(|a,b| b.folder.cmp(&a.folder).then_with(||a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        let parent_uri=if item_path.is_empty() {None} else {source.canonical_uri.trim_end_matches('/').rsplit_once('/').map(|(parent,_)|parent.to_string())};
        Ok(SharePointListing {uri:source.canonical_uri.clone(),parent_uri,entries})
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn root_wiki_and_teams_locations_and_markdown_are_distinct() {
        let source=parse_spmd_uri("spmd://contoso.sharepoint.com/Wiki/日本語.md").unwrap();
        assert_eq!(source.site_path,"/");
        assert_eq!(parse_spmd_location("spmd://contoso.sharepoint.com/Wiki").unwrap().site_path,"/");
        assert!(parse_spmd_uri("spmd://contoso.sharepoint.com/Wiki").is_err());
        assert_eq!(canonical_sharepoint_uri("https://CONTOSO.sharepoint.com/Wiki/a.md".into()).unwrap(),"spmd://contoso.sharepoint.com/Wiki/a.md");
        assert_eq!(parse_spmd_location("spmd://contoso.sharepoint.com/teams/a/Wiki").unwrap().site_path,"/teams/a");
        assert!(canonical_sharepoint_uri("http://contoso.sharepoint.com/Wiki/a.md".into()).is_err());
        for path in ["Wiki/a.aspx","Wiki/a.html","Wiki/../secret.md","Wiki/%2e%2e/secret.md","personal/a/file.md"] {
            assert!(canonical_sharepoint_uri(format!("https://contoso.sharepoint.com/{path}")).is_err(),"{path}");
        }
    }
    #[test]
    fn root_document_images_stay_in_the_same_library() {
        let document=parse_spmd_uri("spmd://contoso.sharepoint.com/Wiki/a.md").unwrap();
        assert!(resolve_spmd_asset_uri(&document,"image.png").is_ok());
        assert!(resolve_spmd_asset_uri(&document,"../Other/image.png").is_err());
    }
    #[test]
    fn graph_paths_select_the_library_root_and_nested_folder() {
        let drives=vec![DriveResponse{id:"drive".into(),web_url:"https://contoso.sharepoint.com/Wiki".into()}];
        let source=parse_spmd_location("spmd://contoso.sharepoint.com/Wiki").unwrap();
        assert_eq!(listing_drive(&drives,&source).unwrap().1,"");
        assert_eq!(children_url(GRAPH_ROOT,"drive",""),format!("{GRAPH_ROOT}/drives/drive/root/children"));
        assert!(children_url(GRAPH_ROOT,"drive","日本語/a").ends_with(":/children"));
        let source=parse_spmd_location("spmd://contoso.sharepoint.com/Wiki/folder").unwrap();
        assert_eq!(listing_drive(&drives,&source).unwrap().1,"folder");
    }
    #[test]
    fn only_markdown_and_safe_folders_are_listed() {
        let source=parse_spmd_location("spmd://contoso.sharepoint.com/Wiki").unwrap();
        assert!(listing_entry(&source,Child{name:"home.aspx".into(),folder:None}).unwrap().is_none());
        let item=listing_entry(&source,Child{name:"日本語.md".into(),folder:None}).unwrap().unwrap();
        assert!(parse_spmd_uri(&item.uri).is_ok());
        assert!(listing_entry(&source,Child{name:"../evil.md".into(),folder:None}).is_err());
        assert!(listing_entry(&source,Child{name:"sub".into(),folder:Some(serde_json::json!({}))}).unwrap().unwrap().folder);
    }
    #[test]
    fn pagination_keeps_authorization_on_the_exact_graph_endpoint() {
        let first="https://graph.microsoft.com/v1.0/drives/a/root/children";
        assert!(checked_next(first,&format!("{first}?$skiptoken=2")).is_ok());
        for next in ["https://evil.example/v1.0/drives/a/root/children", "http://graph.microsoft.com/v1.0/drives/a/root/children", "https://graph.microsoft.com/v1.0/me", "https://user@graph.microsoft.com/v1.0/drives/a/root/children"] {
            assert!(checked_next(first,next).is_err());
        }
    }
}


#[cfg(test)]
mod transport_tests {
    use super::*;
    use std::io::{Read,Write};
    fn server(pages:Vec<(u16,String)>)->(String,std::thread::JoinHandle<Vec<String>>) {
        let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let root=format!("http://{}/v1.0",listener.local_addr().unwrap());
        let root_copy=root.clone();
        let handle=std::thread::spawn(move|| {
            let mut requests=Vec::new();
            for (status,body) in pages {
                let deadline=Instant::now()+Duration::from_secs(10);
                let mut socket=loop {
                    if let Ok((socket,_))=listener.accept(){break socket}
                    assert!(Instant::now()<deadline,"fixture request timed out");std::thread::sleep(Duration::from_millis(5));
                };
                socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut request=Vec::new();let mut part=[0;1024];
                while !request.windows(4).any(|value|value==b"\r\n\r\n") {let count=socket.read(&mut part).unwrap();assert!(count>0);request.extend_from_slice(&part[..count]);assert!(request.len()<8192);}
                requests.push(String::from_utf8(request).unwrap());
                let body=body.replace("$ROOT",&root_copy);
                write!(socket,"HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
            }
            requests
        }); (root,handle)
    }
    fn client()->SharePointClient {
        let mut client=SharePointClient::new().unwrap();
        client.http=Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).build().unwrap();client
    }
    #[tokio::test]
    async fn reads_root_wiki_and_all_pages_with_only_fixture_authorization() {
        let (root,server)=server(vec![
            (200,r#"{"id":"site"}"#.into()),
            (200,r#"{"value":[{"id":"drive","webUrl":"https://contoso.sharepoint.com/Wiki"}]}"#.into()),
            (200,r#"{"value":[{"name":"guide.md"},{"name":"sub","folder":{}},{"name":"home.aspx"}],"@odata.nextLink":"$ROOT/drives/drive/root/children?$skiptoken=2"}"#.into()),
            (200,r#"{"value":[{"name":"日本語.markdown"}]}"#.into()),
        ]);
        let source=parse_spmd_location("spmd://contoso.sharepoint.com/Wiki").unwrap();
        let result=client().list_folder_with_token(&source,&root,"fixture-token").await.unwrap();
        assert!(result.parent_uri.is_none());assert_eq!(result.entries.len(),3);assert!(result.entries[0].folder);
        assert!(result.entries.iter().filter(|item|!item.folder).all(|item|parse_spmd_uri(&item.uri).is_ok()));
        let requests=server.join().unwrap();assert_eq!(requests.len(),4);
        assert!(requests[0].starts_with("GET /v1.0/sites/contoso.sharepoint.com:/ "));
        assert!(requests.iter().all(|request|request.to_ascii_lowercase().contains("authorization: bearer fixture-token")));
    }
    #[tokio::test]
    async fn access_denied_is_not_presented_as_an_empty_successful_library() {
        let (root,server)=server(vec![
            (200,r#"{"id":"site"}"#.into()),
            (200,r#"{"value":[{"id":"drive","webUrl":"https://contoso.sharepoint.com/Wiki"}]}"#.into()),
            (403,r#"{"error":{"code":"accessDenied","message":"fixture denied"}}"#.into()),
        ]);
        let source=parse_spmd_location("spmd://contoso.sharepoint.com/Wiki").unwrap();
        let error=client().list_folder_with_token(&source,&root,"fixture-token").await.unwrap_err().to_string();
        assert!(error.contains("権限"));assert!(error.contains("403"));assert_eq!(server.join().unwrap().len(),3);
    }
}
