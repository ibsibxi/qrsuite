# -*- coding: utf-8 -*-
"""免 Gradle 的 JVM 单元测试运行器（Windows 沙箱专用）。

为什么需要它
────────────
Gradle 的 `testDebugUnitTest` 让测试跑在独立的 **Test Executor 进程**里，两者通过**管道**通信。
本机沙箱**禁用管道**，于是必然失败：

    Could not write standard input to Gradle Test Executor 1.
    java.io.IOException: 管道正在被关闭。
    java.lang.ClassNotFoundException: worker.org.gradle.process.internal.worker.GradleWorkerMain

这不是测试代码的问题。验证方式：先让 Gradle 只做**编译**（不跑 worker），
再用本脚本直接 `java` 启动测试类 —— 全程无管道。

设计
────
· 不引入任何新依赖：复用 Gradle 已经下载到缓存里的 junit-4.13.2 与 hamcrest-core-1.3。
· 不修改被测代码：测试类保持标准 JUnit 形态（CI 上仍可用 Gradle 正常跑）。
· 断言引擎用 org.junit.Assert（JUnit 提供），本脚本只负责**发现与调用**测试方法。

用法
────
    python tools/run_unit_tests.py
退出码：0 = 全部通过；1 = 有失败或环境问题
"""
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ANDROID = os.path.dirname(HERE)                       # .../android
REPO = os.path.dirname(ANDROID)                       # 仓库根

JDK_HOME = r'E:\Program Files\Java\jdk-21.0.11'
JAVAC = os.path.join(JDK_HOME, 'bin', 'javac.exe')
JAVA = os.path.join(JDK_HOME, 'bin', 'java.exe')

GRADLE_HOME = r'E:\学习\Android\.gradle'
ANDROID_SDK = r'E:\学习\Android\sdk'

TEST_CLASSES = os.path.join(ANDROID, 'app', 'build', 'intermediates', 'javac',
                            'debugUnitTest', 'compileDebugUnitTestJavaWithJavac', 'classes')
MAIN_CLASSES = os.path.join(ANDROID, 'app', 'build', 'intermediates', 'javac',
                            'debug', 'compileDebugJavaWithJavac', 'classes')
RUNNER_DIR = os.path.join(ANDROID, 'app', 'build', 'unit-test-runner')

RUNNER_SRC = r'''
import java.lang.reflect.Method;
import java.lang.reflect.InvocationTargetException;
import java.util.ArrayList;
import java.util.List;

/** 极简 JUnit4 运行器：只做「发现 @Test 方法 → 调用 → 汇总」。 */
public class UnitTestRunner {
    public static void main(String[] args) throws Exception {
        int pass = 0;
        List<String> failures = new ArrayList<>();
        System.out.println("运行 " + args.length + " 个测试类");
        System.out.println("------------------------------------------------------------------------");
        for (String cn : args) {
            Class<?> c;
            try {
                c = Class.forName(cn);
            } catch (Throwable t) {
                failures.add(cn + " : 无法加载 -> " + t);
                System.out.println("[加载失败] " + cn + " -> " + t);
                continue;
            }
            for (Method m : c.getDeclaredMethods()) {
                boolean isTest = false;
                for (java.lang.annotation.Annotation a : m.getAnnotations()) {
                    if (a.annotationType().getName().equals("org.junit.Test")) { isTest = true; break; }
                }
                if (!isTest) continue;
                m.setAccessible(true);
                Object inst = c.getDeclaredConstructor().newInstance();
                try {
                    m.invoke(inst);
                    pass++;
                    System.out.println("  PASS  " + c.getSimpleName() + "." + m.getName());
                } catch (InvocationTargetException ite) {
                    Throwable cause = ite.getCause() == null ? ite : ite.getCause();
                    String msg = cause.getClass().getSimpleName() + ": " + String.valueOf(cause.getMessage());
                    failures.add(c.getSimpleName() + "." + m.getName() + " -> " + msg);
                    System.out.println("  FAIL  " + c.getSimpleName() + "." + m.getName());
                    System.out.println("        " + msg.replace("\n", "\n        "));
                }
            }
        }
        System.out.println("------------------------------------------------------------------------");
        System.out.println("通过 " + pass + " / 失败 " + failures.size());
        if (!failures.isEmpty()) {
            System.out.println("\n失败明细：");
            for (String f : failures) System.out.println("  · " + f);
            System.exit(1);
        }
        System.out.println("全部通过");
    }
}
'''


def find_jars():
    """在 Gradle 缓存里找 junit 与 hamcrest。"""
    found = {}
    for name in ('junit-4.13.2.jar', 'hamcrest-core-1.3.jar'):
        for root, _dirs, files in os.walk(os.path.join(GRADLE_HOME, 'caches')):
            if name in files:
                found[name] = os.path.join(root, name)
                break
    return found


def compile_and_run():
    jars = find_jars()
    missing = [n for n in ('junit-4.13.2.jar', 'hamcrest-core-1.3.jar') if n not in jars]
    if missing:
        print('[!] Gradle 缓存里缺少:', missing)
        print('    请在联网环境下先跑一次 Gradle（让依赖落地），或手工提供这两个 jar。')
        return 1
    print('[i] junit    :', jars['junit-4.13.2.jar'])
    print('[i] hamcrest :', jars['hamcrest-core-1.3.jar'])

    android_jar = os.path.join(ANDROID_SDK, 'platforms', 'android-35', 'android.jar')
    if not os.path.isfile(android_jar):
        print('[!] 未找到 android.jar:', android_jar)
        return 1

    for d in (TEST_CLASSES, MAIN_CLASSES):
        if not os.path.isdir(d):
            print('[!] 未找到编译产物:', d)
            print('    请先跑（仅编译，不执行 worker）:')
            print('      gradlew --offline :app:compileDebugUnitTestJavaWithJavac')
            return 1

    # 1) 编译运行器（放在独立目录，避免污染 Gradle 的输出）
    os.makedirs(RUNNER_DIR, exist_ok=True)
    runner_src = os.path.join(RUNNER_DIR, 'UnitTestRunner.java')
    with open(runner_src, 'w', encoding='utf-8', newline='\n') as f:
        f.write(RUNNER_SRC)
    cp_compile = os.pathsep.join([jars['junit-4.13.2.jar'], jars['hamcrest-core-1.3.jar']])
    r = subprocess.run([JAVAC, '-encoding', 'UTF-8', '-d', RUNNER_DIR,
                        '-cp', cp_compile, runner_src],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print('[!] 编译运行器失败:')
        print(r.stdout, r.stderr)
        return 1

    # 2) 找测试类（从已编译的 test classes 里扫描 *Test.class）
    test_classes = []
    for root, _dirs, files in os.walk(TEST_CLASSES):
        for fn in files:
            if fn.endswith('Test.class') and '$' not in fn:
                rel = os.path.relpath(os.path.join(root, fn), TEST_CLASSES)
                test_classes.append(rel[:-len('.class')].replace(os.sep, '.'))
    if not test_classes:
        print('[!] 未在', TEST_CLASSES, '里找到 *Test.class')
        return 1
    print('[i] 测试类:', ', '.join(test_classes))

    # 3) 运行。classpath 可能很长（Gradle transforms 里几百个 jar），
    #    超过 Windows 命令行上限（约 32KB）会报 WinError 206，因此用 @argfile 传参。
    cp_parts = [RUNNER_DIR, TEST_CLASSES, MAIN_CLASSES,
                jars['junit-4.13.2.jar'], jars['hamcrest-core-1.3.jar'], android_jar]
    for root, _dirs, files in os.walk(os.path.join(GRADLE_HOME, 'caches')):
        for fn in files:
            if fn.endswith('.jar') and ('/transforms/' in root.replace(os.sep, '/')):
                cp_parts.append(os.path.join(root, fn))
    cp = os.pathsep.join(cp_parts)
    print('[i] classpath 条目数:', len(cp_parts), '（长度', len(cp), '字符）')

    argfile = os.path.join(RUNNER_DIR, 'java.args')
    # 关键：Java 读取 @argfile 用的是**系统默认编码**（中文 Windows 是 GBK/CP936），
    # 而不是 UTF-8。若按 UTF-8 写，中文路径（E:\学习\...）会被解码成乱码
    # （实测变成 "E:/瀛︿範/..."），于是 classpath 全错、报 ClassNotFoundException。
    # 因此这里按系统默认编码写文件。
    import locale
    enc = locale.getpreferredencoding(False) or 'utf-8'
    # @argfile 引号内的反斜杠是转义符 —— 改用正斜杠（Java 在 Windows 上同样接受）
    cp_fwd = cp.replace('\\', '/')
    with open(argfile, 'w', encoding=enc, newline='\n') as f:
        f.write('-Dfile.encoding=UTF-8\n')
        f.write('-cp\n')
        f.write('"' + cp_fwd + '"\n')
        f.write('UnitTestRunner\n')
        for tc in test_classes:
            f.write(tc + '\n')
    print('[i] argfile 编码:', enc, '（Java 按系统编码读取 @argfile，不能用 UTF-8）')
    print('[i] 使用 argfile:', argfile)
    print()
    r = subprocess.run([JAVA, '@' + argfile],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    print(r.stdout)
    if r.stderr and r.stderr.strip():
        print('[stderr]', r.stderr[:3000])
    return r.returncode


if __name__ == '__main__':
    sys.exit(compile_and_run())
