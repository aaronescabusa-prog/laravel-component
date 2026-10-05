<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Event Reminder</title>
</head>
<body style="margin:0;padding:24px;background-color:#f4f6fb;font-family:Helvetica,Arial,sans-serif;color:#1a1f26;">
    <div style="max-width:560px;margin:0 auto;background-color:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e6ef;">

        {{-- Header bar --}}
        <div style="background-image:linear-gradient(135deg,#14224a 0%,#2c4a9e 100%);padding:22px 28px;">
            <span style="color:#ffffff;font-size:17px;font-weight:bold;letter-spacing:0.04em;">TMC EventEase</span>
        </div>

        <div style="padding:28px;">
            <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.22em;text-transform:uppercase;color:#6b7280;">
                Event Reminder
            </p>
            <h1 style="margin:0 0 18px;font-size:22px;color:#14224a;">
                Hi {{ Illuminate\Support\Str::before($registration->participant, ' ') }}, your event is tomorrow!
            </h1>

            <p style="margin:0 0 18px;font-size:14px;color:#4b5563;line-height:1.6;">
                This is a friendly reminder that you are registered for
                <strong style="color:#1a1f26;">{{ $registration->event }}</strong>.
                A calendar invite is attached — just open it to add the event to your calendar.
            </p>

            {{-- Event details table --}}
            <table role="presentation" cellpadding="0" cellspacing="0"
                   style="width:100%;border-collapse:collapse;margin:0 0 20px;font-size:13px;color:#4b5563;
                          background-color:#f8fafc;border-radius:8px;overflow:hidden;border:1px solid #e2e6ef;">
                @if ($event)
                    @if ($event->venue)
                        <tr>
                            <td style="padding:10px 14px;font-weight:600;color:#374151;width:38%;border-bottom:1px solid #e2e6ef;">📍 Venue</td>
                            <td style="padding:10px 14px;border-bottom:1px solid #e2e6ef;">{{ $event->venue }}</td>
                        </tr>
                    @endif
                    <tr>
                        <td style="padding:10px 14px;font-weight:600;color:#374151;border-bottom:1px solid #e2e6ef;">📅 Date</td>
                        <td style="padding:10px 14px;border-bottom:1px solid #e2e6ef;">
                            {{ \Carbon\Carbon::parse($event->event_date)->format('F j, Y') }}
                            @if ($event->end_date && $event->end_date !== $event->event_date)
                                – {{ \Carbon\Carbon::parse($event->end_date)->format('F j, Y') }}
                            @endif
                        </td>
                    </tr>
                    @if ($event->start_time)
                        <tr>
                            <td style="padding:10px 14px;font-weight:600;color:#374151;border-bottom:1px solid #e2e6ef;">🕐 Time</td>
                            <td style="padding:10px 14px;border-bottom:1px solid #e2e6ef;">
                                {{ \Carbon\Carbon::parse($event->start_time)->format('g:i A') }}
                                @if ($event->end_time)
                                    – {{ \Carbon\Carbon::parse($event->end_time)->format('g:i A') }}
                                @endif
                            </td>
                        </tr>
                    @endif
                @endif
                <tr>
                    <td style="padding:10px 14px;font-weight:600;color:#374151;">🎫 Registration ID</td>
                    <td style="padding:10px 14px;">{{ $registration->reference }}</td>
                </tr>
            </table>

            {{-- QR code block --}}
            @if ($registration->qr_code)
                <div style="margin:0 0 20px;padding:16px;background-color:#f0f4ff;border-radius:8px;border:1px solid #c7d2fe;text-align:center;">
                    <p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#4338ca;">
                        Your Check-in QR Code
                    </p>
                    <p style="margin:0;font-size:18px;font-weight:bold;color:#1e1b4b;letter-spacing:0.08em;">
                        {{ $registration->qr_code }}
                    </p>
                    <p style="margin:6px 0 0;font-size:12px;color:#6b7280;">
                        Present this code at the event entrance.
                    </p>
                </div>
            @endif

            <p style="margin:0 0 18px;font-size:13px;color:#6b7280;line-height:1.6;">
                We look forward to seeing you there. If you have any questions, please contact the event organiser.
            </p>

            <p style="margin:0;font-size:12px;color:#9aa1b1;">
                This message was sent automatically. Please do not reply.
            </p>
        </div>
    </div>
</body>
</html>
