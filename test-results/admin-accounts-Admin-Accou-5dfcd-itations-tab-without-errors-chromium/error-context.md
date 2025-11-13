# Page snapshot

```yaml
- generic [ref=e3]:
  - link "menu.navigation.skip_to_content" [ref=e4] [cursor=pointer]:
    - /url: "#main"
  - navigation [ref=e5]:
    - listitem [ref=e6]:
      - link "< back" [ref=e7] [cursor=pointer]:
        - /url: /profile
    - listitem [ref=e8]:
      - link "General" [ref=e9] [cursor=pointer]:
        - /url: /admin/settings
    - listitem [ref=e10]:
      - link "Accounts" [ref=e11] [cursor=pointer]:
        - /url: /admin/accounts
    - listitem [ref=e12]:
      - link "Federation" [ref=e13] [cursor=pointer]:
        - /url: /admin/federation
    - listitem [ref=e14]:
      - link "Funding" [ref=e15] [cursor=pointer]:
        - /url: /admin/funding
  - main [ref=e16]:
    - region "Accounts" [ref=e17]:
      - heading "Accounts" [level=2] [ref=e18]
      - tablist "Account management sections" [ref=e19]:
        - tab "Accounts" [ref=e20] [cursor=pointer]
        - tab "Applications" [ref=e21] [cursor=pointer]
        - tab "Invitations" [active] [selected] [ref=e22] [cursor=pointer]
      - tabpanel [ref=e23]:
        - region "No Invitations" [ref=e25]:
          - heading "No Invitations" [level=2] [ref=e26]
          - paragraph [ref=e27]: You haven't sent any account invitations yet.
          - button "Invite New Account" [ref=e28] [cursor=pointer]
```