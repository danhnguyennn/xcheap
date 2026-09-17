import React from 'react';
import twitterImg from '../assets/images/storefront_twitter_1789374041650.jpg';
import facebookImg from '../assets/images/storefront_facebook_1789374061137.jpg';
import gmailImg from '../assets/images/storefront_gmail_1789374076403.jpg';
import klingImg from '../assets/images/storefront_kling_1789374089827.jpg';
import telegramImg from '../assets/images/storefront_telegram_1789374112699.jpg';
import tiktokImg from '../assets/images/storefront_tiktok_1789374129800.jpg';
import instagramImg from '../assets/images/storefront_instagram_1789374144282.jpg';
import discordImg from '../assets/images/storefront_discord_1789374156955.jpg';

interface ShopArtProps {
  type: string;
  className?: string;
  badgeText?: string;
  altText?: string;
}

export const ProductShopArt: React.FC<ShopArtProps> = ({
  type,
  className = '',
  badgeText,
  altText,
}) => {
  const normType = (type || '').toLowerCase();

  let imgSrc = twitterImg;
  let title = 'Twitter / X Store';
  let accentColor = 'from-sky-500/20';

  if (normType.includes('twitter') || normType === 'x') {
    imgSrc = twitterImg;
    title = 'Twitter / X Digital Kiosk';
    accentColor = 'from-sky-500/20';
  } else if (normType.includes('facebook') || normType === 'fb') {
    imgSrc = facebookImg;
    title = 'Facebook Digital Kiosk';
    accentColor = 'from-blue-600/20';
  } else if (normType.includes('gmail') || normType.includes('google') || normType.includes('mail')) {
    imgSrc = gmailImg;
    title = 'Gmail Digital Kiosk';
    accentColor = 'from-red-500/20';
  } else if (normType.includes('kling') || normType.includes('ai') || normType.includes('other')) {
    imgSrc = klingImg;
    title = 'Kling AI Digital Kiosk';
    accentColor = 'from-purple-600/20';
  } else if (normType.includes('telegram') || normType === 'tg') {
    imgSrc = telegramImg;
    title = 'Telegram Digital Kiosk';
    accentColor = 'from-emerald-500/20';
  } else if (normType.includes('tiktok') || normType === 'tt') {
    imgSrc = tiktokImg;
    title = 'TikTok Digital Kiosk';
    accentColor = 'from-pink-500/20';
  } else if (normType.includes('instagram') || normType === 'ig' || normType.includes('insta')) {
    imgSrc = instagramImg;
    title = 'Instagram Digital Kiosk';
    accentColor = 'from-rose-500/20';
  } else if (normType.includes('discord') || normType === 'dc') {
    imgSrc = discordImg;
    title = 'Discord Digital Kiosk';
    accentColor = 'from-indigo-600/20';
  }

  return (
    <div className={`relative overflow-hidden w-full h-full bg-[#f3f5f4] dark:bg-[#181a1e] select-none ${className}`}>
      {/* 3D Storefront Image Render */}
      <img
        src={imgSrc}
        alt={altText || title}
        referrerPolicy="no-referrer"
        loading="lazy"
        className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-300 ease-out"
      />

      {/* Subtle depth lighting overlay */}
      <div className={`absolute inset-0 bg-gradient-to-t ${accentColor} via-transparent to-black/15 pointer-events-none`} />

      {badgeText && (
        <div className="absolute top-2 left-2 z-10">
          <span className="bg-red-500 text-slate-900 dark:text-slate-100 font-bold text-[10px] px-2 py-0.5 rounded shadow">
            {badgeText}
          </span>
        </div>
      )}
    </div>
  );
};
