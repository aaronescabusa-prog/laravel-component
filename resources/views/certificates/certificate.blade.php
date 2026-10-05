{{-- Certificate layout used by the PDF renderer.

     When an uploaded template exists it is used as the page background and only
     the participant's name is drawn on top, so the artwork keeps full control of
     the design. Without a template this falls back to a clean default layout. --}}
@php
    $name = e($certificate->participant);
    $event = e($certificate->event);
    $date = e($certificate->date_issued ?: now()->format('F j, Y'));
    $reference = e($certificate->reference);
@endphp

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Certificate {{ $reference }}</title>
    <style>
        @page { margin: 0; }

        html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
        }

        .certificate {
            position: relative;
            width: 100%;
            height: 100vh;
            text-align: center;
            font-family: "DejaVu Serif", Georgia, "Times New Roman", serif;
            color: #1a1f26;
            box-sizing: border-box;
        }

        .background {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            object-fit: fill;
        }

        .body {
            position: relative;
            z-index: 1;
            width: 100%;
            height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
        }

        .eyebrow {
            font-size: 13px;
            letter-spacing: 0.32em;
            text-transform: uppercase;
            color: #4b5563;
            margin: 0 0 6px;
        }

        .institution {
            font-size: 22px;
            font-weight: bold;
            letter-spacing: 0.06em;
            margin: 0 0 18px;
        }

        .title {
            font-size: 30px;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 0.12em;
            margin: 0 0 18px;
            color: #14224a;
        }

        .body-text {
            font-size: 13px;
            color: #4b5563;
            margin: 0 0 8px;
        }

        .name {
            font-size: 34px;
            font-weight: bold;
            color: #1b2f6b;
            margin: 0 0 14px;
            padding-bottom: 6px;
            border-bottom: 1px solid #9aa7c7;
        }

        .event {
            font-size: 17px;
            font-style: italic;
            margin: 0 0 16px;
        }

        .meta {
            font-size: 11px;
            color: #6b7280;
            letter-spacing: 0.06em;
        }

        .divider {
            width: 60%;
            margin: 18px auto 12px;
            border-top: 2px solid #14224a;
        }

        /* Without artwork the default layout needs its own visible frame. */
        .fallback-frame {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100vh;
            border: 14px solid #14224a;
            box-sizing: border-box;
        }
    </style>
</head>
<body>
    <div class="certificate">
        @if ($background)
            <img class="background" src="{{ $background }}" alt="">
        @else
            <div class="fallback-frame"></div>
        @endif

        <div class="body">
            <p class="eyebrow">Certificate of Participation</p>
            <p class="institution">{{ $institution }}</p>
            <p class="title">Awarded To</p>

            <p class="body-text">This is to certify that</p>
            <p class="name">{{ $name }}</p>
            <p class="body-text">has successfully participated in</p>
            <p class="event">{{ $event }}</p>

            <div class="divider"></div>
            <p class="meta">Issued on {{ $date }} &nbsp;&bull;&nbsp; {{ $reference }}</p>
        </div>
    </div>
</body>
</html>