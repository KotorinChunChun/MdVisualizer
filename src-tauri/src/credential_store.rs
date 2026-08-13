use std::ffi::c_void;
use std::ptr;
use thiserror::Error;
use windows_sys::Win32::Foundation::FILETIME;
#[cfg(test)]
use windows_sys::Win32::Security::Credentials::CredDeleteW;
use windows_sys::Win32::Security::Credentials::{
    CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_MAX_CREDENTIAL_BLOB_SIZE,
    CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
};

#[derive(Debug, Error)]
pub enum CredentialStoreError {
    #[error("Windows資格情報マネージャーから資格情報を読み取れませんでした: {0}")]
    Read(std::io::Error),
    #[error("Windows資格情報マネージャーへ資格情報を保存できませんでした: {0}")]
    Write(std::io::Error),
    #[cfg(test)]
    #[error("Windows資格情報マネージャーから資格情報を削除できませんでした: {0}")]
    Delete(std::io::Error),
    #[error("保存された資格情報をUTF-8として読み取れませんでした。")]
    InvalidUtf8,
    #[error("保存された資格情報が空です。")]
    Empty,
    #[error("資格情報がWindows資格情報マネージャーの保存上限を超えています。")]
    TooLarge,
}

fn wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn read_secret(target_name: &str) -> Result<Option<String>, CredentialStoreError> {
    let target_name = wide_null(target_name);
    let mut credential = ptr::null_mut::<CREDENTIALW>();
    let result = unsafe { CredReadW(target_name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) };
    if result == 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(1168) {
            return Ok(None);
        }
        return Err(CredentialStoreError::Read(error));
    }

    let result = unsafe {
        let credential_ref = &*credential;
        if credential_ref.CredentialBlobSize == 0 || credential_ref.CredentialBlob.is_null() {
            CredFree(credential.cast::<c_void>());
            return Err(CredentialStoreError::Empty);
        }
        let bytes = std::slice::from_raw_parts(
            credential_ref.CredentialBlob,
            credential_ref.CredentialBlobSize as usize,
        );
        String::from_utf8(bytes.to_vec()).map_err(|_| CredentialStoreError::InvalidUtf8)
    };
    unsafe { CredFree(credential.cast::<c_void>()) };
    result.map(Some)
}

pub fn write_secret(target_name: &str, secret: &str) -> Result<(), CredentialStoreError> {
    let mut target_name = wide_null(target_name);
    let mut comment = wide_null("MarkdownViewer SharePoint OAuth refresh token");
    let mut username = wide_null("Microsoft SharePoint");
    let mut secret = secret.as_bytes().to_vec();
    if secret.is_empty() {
        return Err(CredentialStoreError::Empty);
    }
    if secret.len() > CRED_MAX_CREDENTIAL_BLOB_SIZE as usize {
        return Err(CredentialStoreError::TooLarge);
    }

    let credential = CREDENTIALW {
        Flags: 0,
        Type: CRED_TYPE_GENERIC,
        TargetName: target_name.as_mut_ptr(),
        Comment: comment.as_mut_ptr(),
        LastWritten: FILETIME {
            dwLowDateTime: 0,
            dwHighDateTime: 0,
        },
        CredentialBlobSize: secret.len() as u32,
        CredentialBlob: secret.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        AttributeCount: 0,
        Attributes: ptr::null_mut(),
        TargetAlias: ptr::null_mut(),
        UserName: username.as_mut_ptr(),
    };
    let result = unsafe { CredWriteW(&credential, 0) };
    if result == 0 {
        return Err(CredentialStoreError::Write(std::io::Error::last_os_error()));
    }
    Ok(())
}

#[cfg(test)]
pub fn delete_secret(target_name: &str) -> Result<(), CredentialStoreError> {
    let target_name = wide_null(target_name);
    let result = unsafe { CredDeleteW(target_name.as_ptr(), CRED_TYPE_GENERIC, 0) };
    if result == 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(1168) {
            return Ok(());
        }
        return Err(CredentialStoreError::Delete(error));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestCredential {
        target_name: String,
    }

    impl TestCredential {
        fn new() -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            Self {
                target_name: format!("MarkdownViewer/Test/{}/{}", std::process::id(), unique),
            }
        }
    }

    impl Drop for TestCredential {
        fn drop(&mut self) {
            let _ = delete_secret(&self.target_name);
        }
    }

    #[test]
    fn stores_rotates_and_deletes_a_secret() {
        let credential = TestCredential::new();
        assert_eq!(read_secret(&credential.target_name).unwrap(), None);

        write_secret(&credential.target_name, "first refresh token").unwrap();
        assert_eq!(
            read_secret(&credential.target_name).unwrap().as_deref(),
            Some("first refresh token")
        );

        write_secret(&credential.target_name, "rotated refresh token").unwrap();
        assert_eq!(
            read_secret(&credential.target_name).unwrap().as_deref(),
            Some("rotated refresh token")
        );

        delete_secret(&credential.target_name).unwrap();
        assert_eq!(read_secret(&credential.target_name).unwrap(), None);
    }

    #[test]
    fn rejects_a_secret_larger_than_credential_manager_allows() {
        let credential = TestCredential::new();
        let oversized = "x".repeat(CRED_MAX_CREDENTIAL_BLOB_SIZE as usize + 1);
        assert!(matches!(
            write_secret(&credential.target_name, &oversized),
            Err(CredentialStoreError::TooLarge)
        ));
    }
}
