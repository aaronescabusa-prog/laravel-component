import { useEffect, useState } from "react";
import QRCode from "qrcode";

function QrCode({ value, size = 132, alt = "QR code" }) {
    const [dataUrl, setDataUrl] = useState(null);

    useEffect(() => {
        let active = true;
        setDataUrl(null);

        if (!value) return undefined;

        QRCode.toDataURL(String(value), {
            width: size,
            margin: 1,
            errorCorrectionLevel: "M",
            color: { dark: "#1f2937", light: "#ffffff" },
        })
            .then((url) => { if (active) setDataUrl(url); })
            .catch(() => { /* invalid value: leave the empty state */ });

        return () => { active = false; };
    }, [value, size]);

    if (!value) {
        return <div className="qr-empty" role="img" aria-label="No QR code assigned">No QR</div>;
    }

    if (!dataUrl) {
        return <div className="qr-empty" aria-label="Generating QR code">…</div>;
    }

    return <img src={dataUrl} alt={alt} width={size} height={size} className="qr-render" />;
}

export default QrCode;