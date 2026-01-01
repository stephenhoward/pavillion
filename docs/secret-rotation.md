# Secret Rotation Guide

This guide documents procedures for rotating each secret type in Pavillion. Regular secret rotation is a security best practice and should be performed periodically or immediately if a secret is suspected to be compromised.

## Overview

Pavillion uses five types of secrets:

| Secret | Purpose | Rotation Impact |
|--------|---------|-----------------|
| `JWT_SECRET` | Signs API authentication tokens | All API tokens invalidated |
| `SESSION_SECRET` | Signs browser session cookies | All sessions invalidated |
| `DB_PASSWORD` | PostgreSQL database access | Brief downtime during rotation |
| `S3_SECRET_KEY` | S3 storage access | Media access interruption if misconfigured |
| `SMTP_PASSWORD` | Email sending | Email delivery paused during rotation |

## Before You Begin

1. **Backup current secrets** to your password manager
2. **Schedule maintenance window** for secrets that cause downtime
3. **Notify users** if rotation will log them out
4. **Have rollback plan** in case of issues

## JWT_SECRET Rotation

### Impact

- All existing API tokens become invalid
- Users must log in again to get new tokens
- Mobile/API clients will receive 401 errors until re-authenticated
- **No downtime** required

### Procedure

1. **Generate new secret:**
   ```bash
   NEW_JWT_SECRET=$(openssl rand -base64 32)
   echo "New JWT_SECRET: $NEW_JWT_SECRET"
   ```

2. **Save to password manager** before proceeding

3. **Update `.env` file:**
   ```bash
   # Edit .env and replace JWT_SECRET value
   sed -i "s/JWT_SECRET=.*/JWT_SECRET=$NEW_JWT_SECRET/" .env
   ```

4. **Update secrets file (if using Docker secrets):**
   ```bash
   echo -n "$NEW_JWT_SECRET" > secrets/jwt_secret.txt
   chmod 600 secrets/jwt_secret.txt
   ```

5. **Restart the application:**
   ```bash
   docker compose restart app
   ```

6. **Verify rotation:**
   ```bash
   # Check logs for successful startup
   docker compose logs app | tail -20

   # Test API authentication (should require new login)
   curl -I http://localhost:3000/api/v1/accounts/me
   ```

### Rollback

If issues occur, restore the previous JWT_SECRET from your password manager and restart.

---

## SESSION_SECRET Rotation

### Impact

- All existing browser sessions become invalid
- Users must log in again
- Session cookies will be rejected
- **No downtime** required

### Procedure

1. **Generate new secret:**
   ```bash
   NEW_SESSION_SECRET=$(openssl rand -base64 32)
   echo "New SESSION_SECRET: $NEW_SESSION_SECRET"
   ```

2. **Save to password manager** before proceeding

3. **Update `.env` file:**
   ```bash
   sed -i "s/SESSION_SECRET=.*/SESSION_SECRET=$NEW_SESSION_SECRET/" .env
   ```

4. **Update secrets file (if using Docker secrets):**
   ```bash
   echo -n "$NEW_SESSION_SECRET" > secrets/session_secret.txt
   chmod 600 secrets/session_secret.txt
   ```

5. **Restart the application:**
   ```bash
   docker compose restart app
   ```

6. **Verify rotation:**
   ```bash
   # Check logs for successful startup
   docker compose logs app | tail -20

   # Visit the application in browser - should require login
   ```

### Rollback

Restore the previous SESSION_SECRET from your password manager and restart.

---

## DB_PASSWORD Rotation

### Impact

- **Brief downtime** while rotating (typically < 1 minute)
- Application cannot connect until both database and app use new password
- No user-facing session impact (existing sessions remain valid)

### Procedure

1. **Generate new password:**
   ```bash
   NEW_DB_PASSWORD=$(openssl rand -base64 32)
   echo "New DB_PASSWORD: $NEW_DB_PASSWORD"
   ```

2. **Save to password manager** before proceeding

3. **Stop the application:**
   ```bash
   docker compose stop app
   ```

4. **Update PostgreSQL password:**
   ```bash
   # Connect to database container
   docker compose exec db psql -U pavillion -d pavillion -c \
     "ALTER USER pavillion WITH PASSWORD '$NEW_DB_PASSWORD';"
   ```

5. **Update `.env` file:**
   ```bash
   sed -i "s/DB_PASSWORD=.*/DB_PASSWORD=$NEW_DB_PASSWORD/" .env
   ```

6. **Update secrets file (if using Docker secrets):**
   ```bash
   echo -n "$NEW_DB_PASSWORD" > secrets/db_password.txt
   chmod 600 secrets/db_password.txt
   ```

7. **Start the application:**
   ```bash
   docker compose start app
   ```

8. **Verify rotation:**
   ```bash
   # Check logs for successful database connection
   docker compose logs app | grep -i "database\|postgres\|ready"

   # Test application functionality
   curl http://localhost:3000/health
   ```

### Rollback

If the application cannot connect:

1. Stop the application: `docker compose stop app`
2. Reset password in PostgreSQL to the previous value
3. Restore previous DB_PASSWORD in `.env` and secrets file
4. Start the application: `docker compose start app`

---

## S3_SECRET_KEY Rotation

### Impact

- Media uploads/downloads may fail during rotation
- **No downtime** if done correctly
- Existing media remains accessible if bucket permissions unchanged

### Prerequisites

- Access to your S3/cloud storage provider console
- New access key generated in provider dashboard

### Procedure

1. **Generate new access key in your cloud provider:**
   - AWS: IAM Console > Users > Security credentials > Create access key
   - DigitalOcean: API > Spaces access keys > Generate new key
   - MinIO: Admin console > Access Keys > Create access key

2. **Save new credentials to password manager**

3. **Test new credentials (optional but recommended):**
   ```bash
   # Using AWS CLI
   AWS_ACCESS_KEY_ID=new_key AWS_SECRET_ACCESS_KEY=new_secret \
     aws s3 ls s3://your-bucket-name/
   ```

4. **Update `.env` file:**
   ```bash
   # Edit .env with new S3_ACCESS_KEY and S3_SECRET_KEY
   ```

5. **Update secrets file (if using Docker secrets):**
   ```bash
   echo -n "your_new_secret_key" > secrets/s3_secret_key.txt
   chmod 600 secrets/s3_secret_key.txt
   ```

6. **Restart the application:**
   ```bash
   docker compose restart app
   ```

7. **Verify rotation:**
   ```bash
   # Upload a test image through the application
   # Check logs for S3 errors
   docker compose logs app | grep -i "s3\|storage"
   ```

8. **Revoke old access key** in your cloud provider console

### Rollback

If media access fails:

1. Restore old S3_ACCESS_KEY and S3_SECRET_KEY in `.env`
2. Restart application
3. Delete the new access key in provider console (if created)

---

## SMTP_PASSWORD Rotation

### Impact

- Email sending pauses during rotation
- No emails delivered until new password is configured
- **No downtime** for the application itself
- Queued emails may fail (depends on email provider)

### Prerequisites

- Access to your email provider/SMTP service dashboard
- New SMTP password or app-specific password

### Procedure

1. **Generate/obtain new SMTP password:**
   - Check your email provider's documentation
   - For Gmail/Google Workspace: Create new app password
   - For transactional email services (SendGrid, Mailgun): Generate new API key

2. **Save new password to password manager**

3. **Update `.env` file:**
   ```bash
   # Edit .env with new SMTP_PASSWORD
   ```

4. **Update secrets file (if using Docker secrets):**
   ```bash
   echo -n "your_new_smtp_password" > secrets/smtp_password.txt
   chmod 600 secrets/smtp_password.txt
   ```

5. **Restart the application:**
   ```bash
   docker compose restart app
   ```

6. **Verify rotation:**
   ```bash
   # Trigger a test email (e.g., password reset request)
   # Check application logs for SMTP errors
   docker compose logs app | grep -i "smtp\|mail\|email"
   ```

7. **Revoke old password** (if applicable)

### Rollback

If email sending fails:

1. Restore old SMTP_PASSWORD in `.env` and secrets file
2. Restart application
3. Delete new password/key if created in email provider

---

## Rotation Schedule Recommendations

| Secret | Recommended Frequency | Emergency Rotation |
|--------|----------------------|-------------------|
| `JWT_SECRET` | Annually | If token theft suspected |
| `SESSION_SECRET` | Annually | If session hijacking suspected |
| `DB_PASSWORD` | Annually | If database credentials exposed |
| `S3_SECRET_KEY` | Annually | If key exposed or employee departure |
| `SMTP_PASSWORD` | Annually | If email account compromised |

## Post-Rotation Checklist

After rotating any secret:

- [ ] New secret saved in password manager
- [ ] Application restarted and running normally
- [ ] Functionality verified (login, media, email as applicable)
- [ ] Old credentials revoked (where applicable)
- [ ] Rotation documented with date in your operations log

## Emergency Rotation

If you suspect a secret has been compromised:

1. **Rotate immediately** - don't wait for maintenance window
2. **Review access logs** for unauthorized activity
3. **Check for unauthorized changes** to calendars/events
4. **Consider notifying users** if their sessions/tokens were at risk
5. **Document the incident** for future reference

## Automation Considerations

For organizations requiring automated rotation:

- Consider using HashiCorp Vault or similar secret management tools
- Implement monitoring for secret age and rotation compliance
- Set up alerts for rotation failures
- Document automation procedures separately

Note: Automated rotation is beyond the scope of this guide and requires additional infrastructure.
