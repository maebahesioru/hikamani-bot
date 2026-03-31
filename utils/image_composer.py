#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自動画像作成機能 - 画像合成スクリプト
4つのレイヤーを合成してオリジナル画像を作成します

レイヤー構成:
1. ue.png (レイヤー1 - 最背面)
2. sita.png (レイヤー2)
3. ユーザー画像 (レイヤー3)
4. ueninokkeru.png (レイヤー4 - 最前面)
"""

import sys
import os
from PIL import Image, ImageEnhance
import traceback

def resize_image_to_fit(image, target_size, maintain_aspect=True):
    """
    画像を指定サイズに合わせてリサイズする
    maintain_aspect=True の場合、アスペクト比を維持して最大サイズに合わせる
    """
    if maintain_aspect:
        # アスペクト比を維持してリサイズ
        image.thumbnail(target_size, Image.Resampling.LANCZOS)
        return image
    else:
        # 強制的に指定サイズにリサイズ
        return image.resize(target_size, Image.Resampling.LANCZOS)

def center_image_on_canvas(image, canvas_size):
    """
    画像をキャンバスの中央に配置する
    """
    canvas = Image.new('RGBA', canvas_size, (0, 0, 0, 0))
    
    # 中央位置を計算
    x = (canvas_size[0] - image.size[0]) // 2
    y = (canvas_size[1] - image.size[1]) // 2
    
    canvas.paste(image, (x, y), image if image.mode == 'RGBA' else None)
    return canvas

def get_optimal_canvas_size(user_image_path, base_layer_path):
    """
    ユーザー画像のアスペクト比に基づいて最適なキャンバスサイズを決定する
    """
    try:
        # ユーザー画像のアスペクト比を取得
        user_image = Image.open(user_image_path)
        user_aspect = user_image.size[0] / user_image.size[1]
        
        # ベースレイヤー（ue.png）のサイズを取得
        if os.path.exists(base_layer_path):
            base_image = Image.open(base_layer_path)
            base_width, base_height = base_image.size
        else:
            # デフォルトサイズ（16:9）
            base_width, base_height = 1920, 1080
        
        # ベースレイヤーのアスペクト比
        base_aspect = base_width / base_height
        
        # ユーザー画像のアスペクト比に合わせてキャンバスサイズを調整
        if abs(user_aspect - base_aspect) < 0.1:  # アスペクト比が近い場合はそのまま
            canvas_size = (base_width, base_height)
        elif user_aspect > base_aspect:  # ユーザー画像が横長
            # 高さを基準に幅を調整
            new_width = int(base_height * user_aspect)
            canvas_size = (new_width, base_height)
        else:  # ユーザー画像が縦長
            # 幅を基準に高さを調整
            new_height = int(base_width / user_aspect)
            canvas_size = (base_width, new_height)
        
        print(f"User aspect ratio: {user_aspect:.2f}")
        print(f"Base aspect ratio: {base_aspect:.2f}")
        print(f"Optimal canvas size: {canvas_size}")
        
        return canvas_size
        
    except Exception as e:
        print(f"Error determining optimal canvas size: {e}")
        # エラー時はデフォルトサイズを返す
        return (1920, 1080)

def load_layer_image(file_path, canvas_size):
    """
    レイヤー画像を読み込み、キャンバスサイズに合わせて処理する
    アスペクト比を維持しながらキャンバス全体をカバーするようにスケール
    """
    try:
        if not os.path.exists(file_path):
            print(f"Warning: Layer image not found: {file_path}")
            return Image.new('RGBA', canvas_size, (0, 0, 0, 0))
        
        image = Image.open(file_path)
        
        # RGBAモードに変換
        if image.mode != 'RGBA':
            image = image.convert('RGBA')
        
        # キャンバスサイズと同じ場合はそのまま返す
        if image.size == canvas_size:
            return image
        
        # アスペクト比を維持しながらキャンバス全体をカバーするようにスケール
        image_aspect = image.size[0] / image.size[1]
        canvas_aspect = canvas_size[0] / canvas_size[1]
        
        if image_aspect > canvas_aspect:
            # 画像が横長の場合、高さを基準にスケール
            scale_factor = canvas_size[1] / image.size[1]
            new_width = int(image.size[0] * scale_factor)
            new_height = canvas_size[1]
        else:
            # 画像が縦長の場合、幅を基準にスケール
            scale_factor = canvas_size[0] / image.size[0]
            new_width = canvas_size[0]
            new_height = int(image.size[1] * scale_factor)
        
        # リサイズ
        scaled_image = image.resize((new_width, new_height), Image.Resampling.LANCZOS)
        
        # キャンバス中央に配置
        canvas = Image.new('RGBA', canvas_size, (0, 0, 0, 0))
        x = (canvas_size[0] - new_width) // 2
        y = (canvas_size[1] - new_height) // 2
        canvas.paste(scaled_image, (x, y), scaled_image)
        
        return canvas
        
    except Exception as e:
        print(f"Error loading layer image {file_path}: {e}")
        return Image.new('RGBA', canvas_size, (0, 0, 0, 0))

def process_user_image(user_image_path, canvas_size):
    """
    ユーザー画像を処理する
    完成形に合わせてより大きく、適切な位置に配置
    """
    try:
        # ユーザー画像を読み込み
        user_image = Image.open(user_image_path)
        
        # RGBAモードに変換
        if user_image.mode != 'RGBA':
            user_image = user_image.convert('RGBA')
        
        # 完成形に合わせたサイズ調整
        # ユーザー画像をキャンバス全体サイズで表示（はみ出し防止）
        # キャンバス全体の幅と高さの100%を使用
        target_width = int(canvas_size[0] * 1.05)   # 幅100%
        target_height = int(canvas_size[1] * 1.05)  # 高さ100%
        max_size = (target_width, target_height)
        
        # アスペクト比を維持してリサイズ
        user_image = resize_image_to_fit(user_image, max_size, maintain_aspect=True)
        
        # より精密な配置：やや上寄りに配置（下のはみ出し防止）
        canvas = Image.new('RGBA', canvas_size, (0, 0, 0, 0))
        
        # 水平中央、垂直はやや上寄りに配置（下はみ出し防止）
        x = (canvas_size[0] - user_image.size[0]) // 2
        y = int((canvas_size[1] - user_image.size[1]) * 0.4)  # やや上寄りに配置
        
        canvas.paste(user_image, (x, y), user_image if user_image.mode == 'RGBA' else None)
        return canvas
        
    except Exception as e:
        print(f"Error processing user image: {e}")
        return Image.new('RGBA', canvas_size, (0, 0, 0, 0))

def compose_images(user_image_path, output_path):
    """
    4つのレイヤーを合成して最終画像を作成する
    """
    try:
        # スクリプトのディレクトリを取得
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(script_dir)
        image_dir = os.path.join(project_root, 'image', 'homizu')
        
        # レイヤー画像のパス
        layer1_path = os.path.join(image_dir, 'ue.png')           # 最背面
        layer2_path = os.path.join(image_dir, 'sita.png')        # レイヤー2
        layer4_path = os.path.join(image_dir, 'ueninokkeru.png') # 最前面
        
        print(f"Layer 1 path: {layer1_path}")
        print(f"Layer 2 path: {layer2_path}")
        print(f"Layer 4 path: {layer4_path}")
        print(f"User image path: {user_image_path}")
        
        # ユーザー画像のアスペクト比に基づいて最適なキャンバスサイズを決定
        canvas_size = get_optimal_canvas_size(user_image_path, layer1_path)
        print(f"Optimal canvas size: {canvas_size}")
        
        # レイヤー1 (最背面) - ue.png
        layer1 = load_layer_image(layer1_path, canvas_size)
        print("Layer 1 loaded")
        
        # レイヤー2 - sita.png
        layer2 = load_layer_image(layer2_path, canvas_size)
        print("Layer 2 loaded")
        
        # レイヤー3 - ユーザー画像
        layer3 = process_user_image(user_image_path, canvas_size)
        print("Layer 3 (user image) processed")
        
        # レイヤー4 (最前面) - ueninokkeru.png
        layer4 = load_layer_image(layer4_path, canvas_size)
        print("Layer 4 loaded")
        
        # 最終キャンバスを作成
        final_image = Image.new('RGBA', canvas_size, (255, 255, 255, 255))
        
        # レイヤーを順番に合成
        print("Compositing layers...")
        
        # レイヤー1 (背面)
        final_image = Image.alpha_composite(final_image, layer1)
        print("Layer 1 composited")
        
        # レイヤー2
        final_image = Image.alpha_composite(final_image, layer2)
        print("Layer 2 composited")
        
        # レイヤー3 (ユーザー画像)
        final_image = Image.alpha_composite(final_image, layer3)
        print("Layer 3 composited")
        
        # レイヤー4 (前面)
        final_image = Image.alpha_composite(final_image, layer4)
        print("Layer 4 composited")
        
        # 最終画像をRGBモードに変換してPNGとして保存
        final_rgb = Image.new('RGB', final_image.size, (255, 255, 255))
        final_rgb.paste(final_image, mask=final_image.split()[-1] if final_image.mode == 'RGBA' else None)
        
        # 出力ディレクトリを作成
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        # 最終画像を保存
        final_rgb.save(output_path, 'PNG', quality=95, optimize=True)
        print(f"Final image saved to: {output_path}")
        
        return True
        
    except Exception as e:
        print(f"Error in compose_images: {e}")
        traceback.print_exc()
        return False

def main():
    """
    メイン関数
    """
    if len(sys.argv) != 3:
        print("Usage: python image_composer.py <user_image_path> <output_path>")
        sys.exit(1)
    
    user_image_path = sys.argv[1]
    output_path = sys.argv[2]
    
    print(f"Starting image composition...")
    print(f"User image: {user_image_path}")
    print(f"Output path: {output_path}")
    
    # ユーザー画像の存在確認
    if not os.path.exists(user_image_path):
        print(f"Error: User image not found: {user_image_path}")
        sys.exit(1)
    
    # 画像合成を実行
    success = compose_images(user_image_path, output_path)
    
    if success:
        print("Image composition completed successfully!")
        sys.exit(0)
    else:
        print("Image composition failed!")
        sys.exit(1)

if __name__ == "__main__":
    main()