from PIL import Image, ImageDraw, ImageFont
import qrcode
import numpy as np

def make_qr(url, size=200):
    qr = qrcode.QRCode(
        version=2,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10,
        border=2,
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white").convert("RGBA")
    img = img.resize((size, size), Image.LANCZOS)
    return img

print("Generating real QR codes...")
qr_assessment = make_qr("https://mechanicalenterprise.com/contact")
qr_promotions = make_qr("https://mechanicalenterprise.com/rebates")

def find_navy_rectangle(img_array, w, h):
    """Find the dark navy empty rectangle in the bottom-right area."""
    # Search in right half, lower portion
    search_x = int(w * 0.5)
    search_y = int(h * 0.55)
    search_y_end = int(h * 0.92)
    
    region = img_array[search_y:search_y_end, search_x:, :]
    r = region[:, :, 0].astype(int)
    g = region[:, :, 1].astype(int)
    b = region[:, :, 2].astype(int)
    
    # Dark navy: low R, low G, medium-low B (roughly 20-40, 40-70, 80-120)
    navy_mask = (r < 60) & (g < 80) & (b > 60) & (b < 160)
    
    rows = np.where(navy_mask.any(axis=1))[0]
    cols = np.where(navy_mask.any(axis=0))[0]
    
    if len(rows) < 10 or len(cols) < 10:
        return None
    
    y1 = rows[0] + search_y
    y2 = rows[-1] + search_y
    x1 = cols[0] + search_x
    x2 = cols[-1] + search_x
    
    return x1, y1, x2, y2

def add_qr_to_navy_zone(input_path, output_path):
    img = Image.open(input_path).convert("RGBA")
    w, h = img.size
    img_array = np.array(img)
    print(f"Processing {input_path} ({w}x{h})")

    bounds = find_navy_rectangle(img_array, w, h)
    if bounds:
        x1, y1, x2, y2 = bounds
        # Add small padding
        x1 += 10; y1 += 10; x2 -= 10; y2 -= 10
        print(f"  Found navy zone: x={x1}-{x2}, y={y1}-{y2}")
    else:
        # Fallback
        x1 = int(w * 0.60); y1 = int(h * 0.65)
        x2 = int(w * 0.97); y2 = int(h * 0.89)
        print(f"  Using fallback zone")

    zone_w = x2 - x1
    zone_h = y2 - y1
    
    # Two buttons side by side
    gap = int(zone_w * 0.04)
    btn_w = (zone_w - gap) // 2
    btn_h = zone_h
    
    btn1_x = x1
    btn2_x = x1 + btn_w + gap
    
    # Draw orange buttons
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    orange = (220, 95, 15, 255)
    
    draw.rounded_rectangle([btn1_x, y1, btn1_x + btn_w, y1 + btn_h], radius=14, fill=orange)
    draw.rounded_rectangle([btn2_x, y1, btn2_x + btn_w, y1 + btn_h], radius=14, fill=orange)
    
    img = Image.alpha_composite(img, overlay)
    
    # Label text
    try:
        font_size = max(20, int(h * 0.024))
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
    except:
        font = ImageFont.load_default()
    
    draw2 = ImageDraw.Draw(img)
    white = (255, 255, 255, 255)
    line_h = int(h * 0.03)
    
    cx1 = btn1_x + btn_w // 2
    cx2 = btn2_x + btn_w // 2
    
    draw2.text((cx1, y1 + 10), "BOOK FREE", font=font, fill=white, anchor="mt")
    draw2.text((cx1, y1 + 10 + line_h), "ASSESSMENT NOW!", font=font, fill=white, anchor="mt")
    
    draw2.text((cx2, y1 + 10), "CHECK", font=font, fill=white, anchor="mt")
    draw2.text((cx2, y1 + 10 + line_h), "PROMOTIONS NOW!", font=font, fill=white, anchor="mt")
    
    # QR codes
    label_h = int(h * 0.075)
    qr_size_fit = min(btn_w - 20, btn_h - label_h - 15)
    qr1 = qr_assessment.resize((qr_size_fit, qr_size_fit), Image.LANCZOS)
    qr2 = qr_promotions.resize((qr_size_fit, qr_size_fit), Image.LANCZOS)
    
    qr_y = y1 + label_h
    qr1_x = btn1_x + (btn_w - qr_size_fit) // 2
    qr2_x = btn2_x + (btn_w - qr_size_fit) // 2
    
    img.paste(qr1, (qr1_x, qr_y), qr1)
    img.paste(qr2, (qr2_x, qr_y), qr2)
    
    img = img.convert("RGB")
    img.save(output_path, quality=95)
    print(f"  -> Saved: {output_path}")

images = [
    ("/home/ubuntu/hvac-ads/oil-clean.jpg",    "/home/ubuntu/hvac-ads/oil-final.jpg"),
    ("/home/ubuntu/hvac-ads/rebate-clean.jpg", "/home/ubuntu/hvac-ads/rebate-final.jpg"),
    ("/home/ubuntu/hvac-ads/hvac-clean.jpg",   "/home/ubuntu/hvac-ads/hvac-final.jpg"),
]

for inp, out in images:
    add_qr_to_navy_zone(inp, out)

print("\nAll done!")
