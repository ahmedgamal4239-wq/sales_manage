import React, { createContext, useContext, useMemo, useState } from 'react';
import { I18nManager } from 'react-native';

type Language = 'ar' | 'en';
const copy = {
  ar: {
    appName: 'دفتر العمليات', tagline: 'إدارة المبيعات اليومية',
    home: 'الرئيسية', sales: 'المبيعات', attendance: 'الحضور', settings: 'الإعدادات',
    loginTitle: 'تسجيل الدخول', employeeId: 'رقم الموظف', password: 'كلمة المرور', signIn: 'دخول',
    wrongLogin: 'تعذر تسجيل الدخول. تحقق من بياناتك وحاول مجدداً.',
    changePassword: 'تغيير كلمة المرور', currentPassword: 'كلمة المرور الحالية', newPassword: 'كلمة المرور الجديدة',
    confirmPassword: 'تأكيد كلمة المرور', passwordRule: 'يجب أن تتكون كلمة المرور الجديدة من 12 حرفاً على الأقل.',
    passwordMismatch: 'كلمتا المرور غير متطابقتين.', savePassword: 'حفظ كلمة المرور',
    greeting: 'مرحباً', today: 'ملخص اليوم', salesTotal: 'إجمالي المبيعات', submittedSales: 'تقارير مرسلة',
    branches: 'الفروع', products: 'المنتجات', people: 'الموظفون', attendanceIssues: 'استثناءات الحضور',
    noBranch: 'لا يوجد فرع مخصص لهذا الحساب. يرجى التواصل مع المدير.', branch: 'الفرع',
    punchIn: 'تسجيل بداية الدوام', punchOut: 'تسجيل نهاية الدوام', lastPunch: 'آخر تسجيل',
    locationHint: 'سيتم طلب الموقع عند التسجيل فقط لتوثيق وقت ومكان الحضور.',
    permissionDenied: 'يلزم السماح بالوصول إلى الموقع لتسجيل الحضور.',
    locationError: 'تعذر تحديد الموقع. تحقق من إعدادات الجهاز وحاول مجدداً.',
    captured: 'تم حفظ تسجيل الحضور', history: 'سجل الحضور', noHistory: 'لا توجد تسجيلات بعد.',
    newReport: 'تقرير مبيعات اليوم', addProduct: 'إضافة منتج', chooseProduct: 'اختر منتجاً',
    quantity: 'الكمية', amount: 'المبلغ', returns: 'المرتجعات', notes: 'ملاحظات',
    saveDraft: 'حفظ كمسودة', submitReport: 'إرسال التقرير', personalHistory: 'تقاريري السابقة',
    noSales: 'لا توجد تقارير مبيعات بعد.', draftSaved: 'تم حفظ المسودة.', reportSent: 'تم إرسال التقرير.',
    selectProduct: 'اختر منتجاً أولاً.', positiveQuantity: 'أدخل كمية أكبر من صفر.',
    signOut: 'تسجيل الخروج', retry: 'إعادة المحاولة', language: 'English',
    status: 'الحالة', net: 'الصافي', date: 'التاريخ', noData: 'لا توجد بيانات للعرض.',
    signedIn: 'تم تسجيل الدخول بنجاح.', passwordChanged: 'تم تغيير كلمة المرور.',
    managerView: 'نظرة المدير', userRole: 'الدور', roleManager: 'مدير', roleSeller: 'بائع',
    readOnly: 'عرض فقط', units: 'وحدة', salesLabel: 'المبيعات',
  },
  en: {
    appName: 'Operations Ledger', tagline: 'Daily sales operations',
    home: 'Home', sales: 'Sales', attendance: 'Attendance', settings: 'Settings',
    loginTitle: 'Sign in', employeeId: 'Employee ID', password: 'Password', signIn: 'Sign in',
    wrongLogin: 'Unable to sign in. Check your credentials and try again.',
    changePassword: 'Change password', currentPassword: 'Current password', newPassword: 'New password',
    confirmPassword: 'Confirm password', passwordRule: 'Your new password must be at least 12 characters.',
    passwordMismatch: 'Passwords do not match.', savePassword: 'Save password',
    greeting: 'Welcome', today: "Today's overview", salesTotal: 'Sales total', submittedSales: 'Submitted reports',
    branches: 'Branches', products: 'Products', people: 'Employees', attendanceIssues: 'Attendance exceptions',
    noBranch: 'No branch is assigned to this account. Please contact your manager.', branch: 'Branch',
    punchIn: 'Clock in', punchOut: 'Clock out', lastPunch: 'Last punch',
    locationHint: 'Location is requested only when you record a punch to capture its time and position.',
    permissionDenied: 'Location permission is required to record attendance.',
    locationError: 'Could not determine your location. Check device settings and try again.',
    captured: 'Attendance punch saved', history: 'Attendance history', noHistory: 'No punches yet.',
    newReport: "Today's sales report", addProduct: 'Add product', chooseProduct: 'Choose a product',
    quantity: 'Quantity', amount: 'Amount', returns: 'Returns', notes: 'Notes',
    saveDraft: 'Save draft', submitReport: 'Submit report', personalHistory: 'My previous reports',
    noSales: 'No sales reports yet.', draftSaved: 'Draft saved.', reportSent: 'Report submitted.',
    selectProduct: 'Choose a product first.', positiveQuantity: 'Enter a quantity greater than zero.',
    signOut: 'Sign out', retry: 'Try again', language: 'العربية',
    status: 'Status', net: 'Net', date: 'Date', noData: 'Nothing to show yet.',
    signedIn: 'Signed in successfully.', passwordChanged: 'Password changed.',
    managerView: 'Manager overview', userRole: 'Role', roleManager: 'Manager', roleSeller: 'Seller',
    readOnly: 'Read only', units: 'units', salesLabel: 'Sales',
  },
} as const;

type Key = keyof typeof copy.en;
const LanguageContext = createContext<{ language: Language; isRTL: boolean; toggle: () => void; t: (key: Key) => string }>({
  language: 'ar', isRTL: true, toggle: () => undefined, t: (key) => copy.ar[key],
});
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>('ar');
  const value = useMemo(() => ({
    language,
    isRTL: language === 'ar',
    toggle: () => setLanguage((current) => current === 'ar' ? 'en' : 'ar'),
    t: (key: Key) => copy[language][key],
  }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
export function useLanguage() { return useContext(LanguageContext); }