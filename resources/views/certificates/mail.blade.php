<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Your certificate</title>
</head>
<body style="margin:0;padding:24px;background-color:#f4f6fb;font-family:Helvetica,Arial,sans-serif;color:#1a1f26;">
    <div style="max-width:560px;margin:0 auto;background-color:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e6ef;">
        <div style="background-image:linear-gradient(135deg,#14224a 0%,#2c4a9e 100%);padding:22px 28px;">
            <span style="color:#ffffff;font-size:17px;font-weight:bold;letter-spacing:0.04em;">TMC EventEase</span>
        </div>

        <div style="padding:28px;">
            <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.22em;text-transform:uppercase;color:#6b7280;">
                Certificate of Participation
            </p>
            <h1 style="margin:0 0 18px;font-size:22px;color:#14224a;">
                Congratulations, {{ \Illuminate\Support\Str::before($certificate->participant, ' ') }}!
            </h1>

            <p style="margin:0 0 8px;font-size:14px;color:#4b5563;line-height:1.6;">
                Your certificate for
                <strong style="color:#1a1f26;">{{ $certificate->event }}</strong>
                is attached to this email.
            </p>

            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;font-size:13px;color:#4b5563;">
                <tr>
                    <td style="padding:4px 16px 4px 0;">Reference</td>
                    <td style="padding:4px 0;font-weight:bold;color:#1a1f26;">{{ $certificate->reference }}</td>
                </tr>
                @if ($certificate->date_issued)
                    <tr>
                        <td style="padding:4px 16px 4px 0;">Issued on</td>
                        <td style="padding:4px 0;font-weight:bold;color:#1a1f26;">{{ $certificate->date_issued }}</td>
                    </tr>
                @endif
            </table>

            <p style="margin:0 0 18px;font-size:13px;color:#6b7280;line-height:1.6;">
                Please keep this file for your records. You may print it directly or save it
                to your device.
            </p>

            <p style="margin:0;font-size:12px;color:#9aa1b1;">
                This message was sent automatically. Please do not reply.
            </p>
        </div>
    </div>
</body>
</html>