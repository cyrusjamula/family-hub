# Notification and location acceptance

Each family member uses their own authorized account and enables their own device. Automated fixtures prove application boundaries; they do not prove browser or operating-system delivery. Record only device/browser type, role, pass/fail and time in private rollout notes. Do not publish subscription endpoints, coordinates, private screenshots or permission exports.

## Notifications

1. Open Settings and confirm the displayed person is you. Select **Enable notifications**, then decide whether to allow the browser permission. The Hub must not register a subscription after denial or on an unsupported browser.
2. With permission granted, expect **Notifications enabled on this device**. A configured server public key alone does not establish a subscription or prove delivery.
3. After approval for the one-device test notification, choose **Send me a test alert** once. The alert is generic: **Family Hub — There is a new update in your hub. Sign in to view it.** Provider acceptance and actual visible delivery are separate checks. Keep the Hub closed or in the background for the delivery observation.
4. Select **Turn off**, verify the status is off, and confirm no subsequent test can be sent without enabling again. Browser permission can remain granted after the subscription is removed.
5. If the device changes users, disable the previous account's subscription before enabling the next account. The server refuses cross-account transfer. The five-device cap permits renewing an existing device without adding another.
6. For each parent and child, verify room eligibility. Children must never receive Parents notices. Use synthetic, approved notices only; never use private family content for notification testing.

On iPhone/iPad the Hub UI directs users to the installed Home Screen app. If a browser reports unsupported or cannot subscribe in a private window, record that limitation and test a supported normal session. Do not claim an untested browser/device combination works.

## Optional location

1. Before selecting **Enable location**, expect no location request or background collection. Denial or an unavailable signal must leave chat usable without location.
2. If the user grants access, coordinates are rounded to two decimals and held on the page. Acquiring location alone must not send it to the server.
3. Only checking the explicit attachment option adds that approximate location to the next submitted message. Review the room audience first. The selection clears after submission; the next message must not attach it automatically.
4. **Clear location** removes the page's value and hides the attachment option. Revoke browser permission in site settings if desired. Never submit real coordinates just to demonstrate the workflow; automated synthetic coordinates cover attachment behavior.

## Automated checks

`test/device-client.test.js` uses simulated device APIs and a mocked server for permission denial, unsupported browsers, consent order, subscription lifecycle, explicit test alerts, location rounding/selection and shared-device rejection. `test/push-boundaries.test.js` uses disposable SQLite and mocked push providers for encrypted endpoints, wrong-owner access, device caps, concurrent scheduler delivery, child isolation, service failures and retired endpoints.

No actual device subscription, push request, location acquisition or provider message occurs in these tests. Live family-device acceptance remains open in issue #7 until independently observed or explicitly recorded as user-reported.
