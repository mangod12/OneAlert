"""
Email alert service for sending vulnerability notifications via Mailgun.
Handles email composition and delivery for security alerts.
"""

import logging
import requests
from requests.adapters import HTTPAdapter, Retry
from typing import Dict
from datetime import datetime

from backend.config import settings
from backend.models.user import User
from backend.models.asset import Asset
from backend.models.alert import Alert

logger = logging.getLogger(__name__)


class EmailService:
    """Service for sending email alerts using Mailgun."""
    
    def __init__(self):
        self.api_key = settings.mailgun_api_key
        self.domain = settings.mailgun_domain
        self.from_email = settings.from_email
        self.base_url = f"https://api.mailgun.net/v3/{self.domain}"
    
    async def send_vulnerability_alert(self, user: User, asset: Asset, alert: Alert, cve_data: Dict):
        """Send email alert for a CVE vulnerability."""
        if not self._is_configured():
            logger.warning("Email service not configured, skipping email")
            return False
        
        subject = f"🚨 Security Alert: {cve_data.get('cve_id', 'CVE')} affects {asset.name}"
        
        html_content = self._generate_cve_email_html(user, asset, alert, cve_data)
        text_content = self._generate_cve_email_text(user, asset, alert, cve_data)
        
        return await self._send_email(
            to_email=user.email,
            subject=subject,
            html_content=html_content,
            text_content=text_content
        )
    
    async def send_vendor_advisory_alert(self, user: User, asset: Asset, alert: Alert, advisory_data: Dict):
        """Send email alert for a vendor security advisory."""
        if not self._is_configured():
            logger.warning("Email service not configured, skipping email")
            return False
        
        vendor = advisory_data.get('vendor', 'Vendor')
        advisory_id = advisory_data.get('vendor_advisory_id', 'Advisory')
        
        subject = f"🚨 {vendor} Security Advisory: {advisory_id} affects {asset.name}"
        
        html_content = self._generate_advisory_email_html(user, asset, alert, advisory_data)
        text_content = self._generate_advisory_email_text(user, asset, alert, advisory_data)
        
        return await self._send_email(
            to_email=user.email,
            subject=subject,
            html_content=html_content,
            text_content=text_content
        )
    
    def _generate_cve_email_html(self, user: User, asset: Asset, alert: Alert, cve_data: Dict) -> str:
        """Generate HTML email content for CVE alert."""
        severity_colors = {
            'critical': '#dc3545',
            'high': '#fd7e14',
            'medium': '#ffc107',
            'low': '#28a745'
        }
        
        severity = cve_data.get('severity', 'unknown')
        color = severity_colors.get(severity, '#6c757d')
        cvss_score = cve_data.get('cvss_score', 'N/A')
        
        return f"""
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; }}
                .header {{ background-color: #f8f9fa; padding: 20px; text-align: center; }}
                .content {{ padding: 20px; }}
                .severity {{ 
                    background-color: {color}; 
                    color: white; 
                    padding: 5px 10px; 
                    border-radius: 5px; 
                    display: inline-block;
                    font-weight: bold;
                }}
                .asset-info {{ 
                    background-color: #e9ecef; 
                    padding: 15px; 
                    border-radius: 5px; 
                    margin: 15px 0;
                }}
                .cta-button {{
                    background-color: #007bff;
                    color: white;
                    padding: 10px 20px;
                    text-decoration: none;
                    border-radius: 5px;
                    display: inline-block;
                    margin-top: 15px;
                }}
                .footer {{ background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; }}
            </style>
        </head>
        <body>
            <div class="header">
                <h1>🚨 Security Vulnerability Alert</h1>
            </div>
            
            <div class="content">
                <p>Hello {user.full_name or user.email},</p>
                
                <p>A new security vulnerability has been identified that affects one of your monitored assets:</p>
                
                <div class="asset-info">
                    <h3>Affected Asset</h3>
                    <strong>Name:</strong> {asset.name}<br>
                    <strong>Type:</strong> {asset.asset_type}<br>
                    <strong>Vendor:</strong> {asset.vendor or 'N/A'}<br>
                    <strong>Product:</strong> {asset.product or 'N/A'}<br>
                    <strong>Version:</strong> {asset.version or 'N/A'}
                </div>
                
                <h3>Vulnerability Details</h3>
                <p><strong>CVE ID:</strong> {cve_data.get('cve_id', 'N/A')}</p>
                <p><strong>Severity:</strong> <span class="severity">{severity.upper()}</span></p>
                <p><strong>CVSS Score:</strong> {cvss_score}</p>
                
                <h4>Description</h4>
                <p>{cve_data.get('description', 'No description available.')}</p>
                
                <a href="{cve_data.get('source_url', '#')}" class="cta-button">View Full Details</a>
                
                <hr style="margin: 30px 0;">
                
                <h4>Recommended Actions</h4>
                <ul>
                    <li>Review the vulnerability details immediately</li>
                    <li>Check if patches or updates are available</li>
                    <li>Consider temporary mitigations if patches are not yet available</li>
                    <li>Monitor vendor advisories for additional information</li>
                </ul>
                
                <p><em>This alert was generated on {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC</em></p>
            </div>
            
            <div class="footer">
                <p>This alert was sent by {settings.app_name}. If you no longer wish to receive these alerts, please contact support.</p>
            </div>
        </body>
        </html>
        """
    
    def _generate_cve_email_text(self, user: User, asset: Asset, alert: Alert, cve_data: Dict) -> str:
        """Generate plain text email content for CVE alert."""
        return f"""
Security Vulnerability Alert

Hello {user.full_name or user.email},

A new security vulnerability has been identified that affects one of your monitored assets.

AFFECTED ASSET:
- Name: {asset.name}
- Type: {asset.asset_type}
- Vendor: {asset.vendor or 'N/A'}
- Product: {asset.product or 'N/A'}
- Version: {asset.version or 'N/A'}

VULNERABILITY DETAILS:
- CVE ID: {cve_data.get('cve_id', 'N/A')}
- Severity: {cve_data.get('severity', 'unknown').upper()}
- CVSS Score: {cve_data.get('cvss_score', 'N/A')}

DESCRIPTION:
{cve_data.get('description', 'No description available.')}

RECOMMENDED ACTIONS:
- Review the vulnerability details immediately
- Check if patches or updates are available
- Consider temporary mitigations if patches are not yet available
- Monitor vendor advisories for additional information

For full details, visit: {cve_data.get('source_url', 'N/A')}

This alert was generated on {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC

---
This alert was sent by {settings.app_name}.
        """
    
    def _generate_advisory_email_html(self, user: User, asset: Asset, alert: Alert, advisory_data: Dict) -> str:
        """Generate HTML email content for vendor advisory alert."""
        severity_colors = {
            'critical': '#dc3545',
            'high': '#fd7e14',
            'medium': '#ffc107',
            'low': '#28a745'
        }
        
        severity = advisory_data.get('severity', 'unknown')
        color = severity_colors.get(severity, '#6c757d')
        vendor = advisory_data.get('vendor', 'Vendor')
        
        return f"""
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; }}
                .header {{ background-color: #f8f9fa; padding: 20px; text-align: center; }}
                .content {{ padding: 20px; }}
                .severity {{ 
                    background-color: {color}; 
                    color: white; 
                    padding: 5px 10px; 
                    border-radius: 5px; 
                    display: inline-block;
                    font-weight: bold;
                }}
                .asset-info {{ 
                    background-color: #e9ecef; 
                    padding: 15px; 
                    border-radius: 5px; 
                    margin: 15px 0;
                }}
                .cta-button {{
                    background-color: #007bff;
                    color: white;
                    padding: 10px 20px;
                    text-decoration: none;
                    border-radius: 5px;
                    display: inline-block;
                    margin-top: 15px;
                }}
                .footer {{ background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; }}
            </style>
        </head>
        <body>
            <div class="header">
                <h1>🚨 {vendor} Security Advisory</h1>
            </div>
            
            <div class="content">
                <p>Hello {user.full_name or user.email},</p>
                
                <p>A new security advisory from {vendor} affects one of your monitored assets:</p>
                
                <div class="asset-info">
                    <h3>Affected Asset</h3>
                    <strong>Name:</strong> {asset.name}<br>
                    <strong>Type:</strong> {asset.asset_type}<br>
                    <strong>Vendor:</strong> {asset.vendor or 'N/A'}<br>
                    <strong>Product:</strong> {asset.product or 'N/A'}<br>
                    <strong>Version:</strong> {asset.version or 'N/A'}
                </div>
                
                <h3>Advisory Details</h3>
                <p><strong>Advisory ID:</strong> {advisory_data.get('vendor_advisory_id', 'N/A')}</p>
                <p><strong>Severity:</strong> <span class="severity">{severity.upper()}</span></p>
                <p><strong>Title:</strong> {advisory_data.get('title', 'N/A')}</p>
                
                <h4>Description</h4>
                <p>{advisory_data.get('description', 'No description available.')}</p>
                
                <a href="{advisory_data.get('source_url', '#')}" class="cta-button">View Advisory</a>
                
                <p><em>This alert was generated on {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC</em></p>
            </div>
            
            <div class="footer">
                <p>This alert was sent by {settings.app_name}.</p>
            </div>
        </body>
        </html>
        """
    
    def _generate_advisory_email_text(self, user: User, asset: Asset, alert: Alert, advisory_data: Dict) -> str:
        """Generate plain text email content for vendor advisory alert."""
        vendor = advisory_data.get('vendor', 'Vendor')
        
        return f"""
{vendor} Security Advisory Alert

Hello {user.full_name or user.email},

A new security advisory from {vendor} affects one of your monitored assets.

AFFECTED ASSET:
- Name: {asset.name}
- Type: {asset.asset_type}
- Vendor: {asset.vendor or 'N/A'}
- Product: {asset.product or 'N/A'}
- Version: {asset.version or 'N/A'}

ADVISORY DETAILS:
- Advisory ID: {advisory_data.get('vendor_advisory_id', 'N/A')}
- Severity: {advisory_data.get('severity', 'unknown').upper()}
- Title: {advisory_data.get('title', 'N/A')}

DESCRIPTION:
{advisory_data.get('description', 'No description available.')}

For full details, visit: {advisory_data.get('source_url', 'N/A')}

This alert was generated on {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC

---
This alert was sent by {settings.app_name}.
        """
    
    async def _send_email(self, to_email: str, subject: str, html_content: str, text_content: str) -> bool:
        """Send email using Mailgun API with retry and timeout."""
        session = requests.Session()
        retries = Retry(total=3, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504])
        session.mount('https://', HTTPAdapter(max_retries=retries))
        try:
            response = session.post(
                f"{self.base_url}/messages",
                auth=("api", self.api_key),
                data={
                    "from": self.from_email,
                    "to": to_email,
                    "subject": subject,
                    "text": text_content,
                    "html": html_content
                },
                timeout=30
            )
            if response.status_code == 200:
                logger.info(f"Email sent successfully to {to_email}")
                return True
            else:
                logger.error(f"Failed to send email to {to_email}: {response.status_code} - {response.text}")
                return False
        except Exception as e:
            logger.error(f"Error sending email to {to_email}: {e}")
            return False
    
    def _is_configured(self) -> bool:
        """Check if email service is properly configured."""
        return bool(self.api_key and self.domain and self.from_email)


# Global email service instance
email_service = EmailService()