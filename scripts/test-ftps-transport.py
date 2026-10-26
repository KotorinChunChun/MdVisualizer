"""限定Web公開が証明書検証付きFTPSだけを使うことを検証する。"""
import ssl
import unittest
from unittest.mock import MagicMock, patch

import web_limited_publish as publisher


SETTINGS = publisher.Settings('219.94.129.84', 'synthetic-user', 'synthetic-password', 21, '/synthetic')


class FtpsTransportTests(unittest.TestCase):
    def test_encrypts_control_before_login_and_private_data(self):
        ftp = MagicMock()
        with patch.object(publisher.ftplib, 'FTP_TLS', return_value=ftp) as factory:
            self.assertIs(publisher.FtpTransport(SETTINGS)._connect(), ftp)
        context = factory.call_args.kwargs['context']
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertEqual(ftp.host, 'www1074.sakura.ne.jp')
        self.assertEqual([c[0] for c in ftp.mock_calls], ['connect', 'auth', 'login', 'prot_p', 'set_pasv'])

    def test_bad_certificate_closes_before_credentials(self):
        ftp = MagicMock()
        ftp.auth.side_effect = ssl.SSLCertVerificationError('synthetic-error')
        with patch.object(publisher.ftplib, 'FTP_TLS', return_value=ftp):
            with self.assertRaises(publisher.PublishError):
                publisher.FtpTransport(SETTINGS)._connect()
        ftp.login.assert_not_called()
        ftp.close.assert_called_once()

    def test_unprotected_data_connection_never_transfers(self):
        ftp = MagicMock()
        ftp.prot_p.side_effect = OSError('synthetic-error')
        with patch.object(publisher.ftplib, 'FTP_TLS', return_value=ftp):
            with self.assertRaises(publisher.PublishError):
                publisher.FtpTransport(SETTINGS)._connect()
        ftp.storbinary.assert_not_called()
        ftp.close.assert_called_once()

    def test_plain_ftp_configuration_is_rejected(self):
        with patch.object(publisher, 'load_env', return_value={'FTP_TLS': 'false'}):
            with self.assertRaisesRegex(publisher.PublishError, 'FTPS専用'):
                publisher.load_settings()

    def test_login_error_does_not_expose_settings(self):
        ftp = MagicMock()
        ftp.login.side_effect = OSError('synthetic-password')
        with patch.object(publisher.ftplib, 'FTP_TLS', return_value=ftp):
            with self.assertRaises(publisher.PublishError) as result:
                publisher.FtpTransport(SETTINGS)._connect()
        self.assertNotIn('synthetic-password', str(result.exception))
        ftp.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
