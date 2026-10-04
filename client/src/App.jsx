import React, { useRef } from "react";
import { useState, useEffect } from "react";

import "./App.css"

const API_URL = import.meta.env.VITE_API_URL || '/api';

export default function App({}) {
    const [myImages, setImages] = useState([]);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [url, setUrl] = useState(null);
    const [name, setName] = useState('');

    const [isSearch, setIsSearch] = useState(true);
    const [searchName, setSearchName] = useState('');

    function getPublicUrl(key) {
        if (!key) return;
        return `https://s3.twcstorage.ru/3e88f5e3-35cc-4a02-9d3c-95cfbb3707c0/${key}`;
    }

    useEffect(() => {
        if (isSearch) return;
        async function getKeys() {
            setImages([]);
            const res = await fetch(API_URL + `/files/allkeys`, { method: 'GET' });
            const data = await res.json();
            if (data.success) {
                setImages((prev) => [...prev, ...data.keys]);
            } else {
                alert('Ошибка загрузки файлов: ', data.error);
            }
        }
        getKeys();

    }, [isSearch]);

    async function uploadViaBuffer(file) {
        if (!file || !name) return;
        const formData = new FormData();
        formData.append('file', file);
        try {
            const query = new URLSearchParams({ name });
            const res = await fetch(API_URL + `/s3/upload?${query.toString()}`, {
                method: 'POST',
                body: formData,
            });
            const resJson = await res.json();
            
            setImages((prev) => [{
                filename: file.name,
                name: name,
                createdAt: Date.now(),
                storageKey: resJson.key
            }, ...prev]);
        } catch (err) {
            console.error('Ошибка загрузки файла:', err);
        }
    }
    function uploadWithProgress(file, onProgress) {
        return new Promise((resolve, reject) => {
            const formData = new FormData();
            formData.append('purpose', 'avatar');
            formData.append('file', file);

            const xhr = new XMLHttpRequest();
            const query = new URLSearchParams({ name });
            xhr.open('POST', API_URL + `/s3/stream-upload?${query.toString()}`);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    onProgress(Math.round((e.loaded / e.total) * 100));
                }
            };

            xhr.onload = () => {
                let res = null;
                try {
                    res = JSON.parse(xhr.responseText);
                } catch { }
                if (xhr.status >= 200 && xhr.status < 300) {
                    if (res) resolve(res);
                    else reject(new Error('Сервер вернул некорректный ответ'));
                } else {
                    reject(new Error('Ошибка загрузки: ' + (res?.error || `HTTP ${xhr.status}`)));
                }
            };
            xhr.onerror = () => reject(new Error('Сетевая ошибка'));

            xhr.send(formData);
        });
    }
    async function uploadViaStream(file) {
        if (!file || !name) return;
        setUploadProgress(0);
        try {
            const result = await uploadWithProgress(file, setUploadProgress); // ждём, пока Promise выполнится (resolve)
            setImages((prev) => [{
                filename: file.name,
                name,
                createdAt: Date.now(),
                storageKey: result.key
            }, ...prev]);
        } catch (err) {
            console.log('Ошибка:', err.message); // сюда попадём, если был reject
        } finally {
            setUploadProgress(0);
        }
    }
    async function uploadDirectToS3(file) {
        const query = new URLSearchParams({filename: file.name, name: name, type: file.type, size: file.size});
        const res = await fetch(`${API_URL}/s3/presigned-upload-url?${query.toString()}`);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Не удалось получить ссылку');
        }
        const { url, key } = await res.json();
        const uploadRes = await fetch(url, {
            method: 'PUT',
            body: file,
            headers: {
                'Content-Type': file.type, // должен совпадать с тем, что было при генерации ссылки
            },
        });

        if (!uploadRes.ok) {
            throw new Error('Не удалось загрузить файл в хранилище');
        }
        setUrl(url)
        // 3. Сообщаем своему серверу, что файл загружен
        const confirmQuery = new URLSearchParams({ key, filename: file.name });
        const confirmRes = await fetch(`${API_URL}/s3/confirm-upload?${confirmQuery.toString()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });

        if (!confirmRes.ok) {
            throw new Error('Не удалось подтвердить загрузку');
        }
        const confirmResj = await confirmRes.json();
        return confirmResj;
        
    }
    async function uploadViaUrl(file) {
        if (!file || !name) return;
        try {
            const result = await uploadDirectToS3(file);
            setImages((prev) => [{
                filename: file.name,
                name,
                createdAt: Date.now(),
                storageKey: result.storageKey
            }, ...prev]);
        } catch (err) {
            console.error('Ошибка:', err.message); // сюда прилетит наш throw
        }
    }
    async function deleteFile(key) {
        if (!confirm('Удалить файл?')) return;
        const paramKey = key.split('/')[1]
        const res = await fetch(API_URL + `/files/key/${paramKey}`, {
            method: 'DELETE'
        });
        const resJson = await res.json();
        if (resJson.success) {
            setImages((prev) => prev.filter((img) => img.storageKey !== key));
        } else {
            console.error('Ошибка удаления:', resJson.error);
        }

    }
    async function renameFile(key) {
        const name = prompt('Новое имя файла (до 16 символов)')?.trim();
        if (!name) return; // отмена или без изменений
        if (name.length > 16) {
            alert('Имя не должно быть длиннее 16 символов');
            return;
        }
        const paramKey = key.split('/')[1];
        const res = await fetch(API_URL + `/files/key/${paramKey}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        const resJson = await res.json();
        if (resJson.success) {
            setImages((prev) => prev.map((img) => (img.storageKey === key ? { ...img, name } : img)));
        } else {
            console.error('Ошибка переименования:', resJson.error);
        }
    }
    async function eSearch(name) {
        
    }

    return (
        <div className="main">
            <p>S3 Bucket: <a href="https://timeweb.cloud/my/storage/562591/dashboard" target="_blank">3e88f5e3-35cc-4a02-9d3c-95cfbb3707c0</a></p>
            <input className={'inputName'} value={name} placeholder={'Enter file name'} onChange={(e) => setName(e.target.value)}/>
            <label>
                Upload Image via server's buffer
                <input type="file" accept="image/*" onChange={(e) => uploadViaBuffer(e.target.files[0])}/>
            </label>
            <label>
                Upload Image via stream
                {uploadProgress > 0 && (
                    <div>
                        <progress value={uploadProgress} max="100" />
                        <span>{uploadProgress}%</span>
                    </div>
                )}
                <input type="file" accept="image/*" onChange={(e) => uploadViaStream(e.target.files[0])}/>
            </label>
            <label>
                Upload Image via url
                <input type="file" accept="image/*" onChange={(e) => uploadViaUrl(e.target.files[0])}/>
                <p>{url && `Url: ${url}`}</p>
            </label>
            <div className="filesBlock">
                <span>
                    <input
                        type="checkbox"
                        checked={isSearch}
                        onChange={(e) => setIsSearch(e.target.checked)}
                    />
                    Найти в поиске
                </span>
                
                { isSearch ? (
                    <div>
                        <p>Поиск:</p>
                        <input className={'inputName'} value={searchName} placeholder={'Search'} onChange={(e) => setSearchName(e.target.value)}/>
                        <button onClick={() => eSearch(searchName)}>Search</button>
                    </div>
                ) : (
                    <div>
                        <p>Загруженные картинки:</p>
                            <ul>
                                {myImages.map((img) => (
                                    <li key={img.storageKey}>
                                        <p>{img.name} | {img.filename}</p>
                                        <p>{new Date(img.createdAt).toLocaleString('ru-RU', {
                                            dateStyle: 'short',
                                            timeStyle: 'short',
                                        })}</p>
                                        <div className="frame">
                                            <img className="frame-bg" src={getPublicUrl(img.storageKey)} alt="" aria-hidden="true" />
                                            <img className="frame-img" src={getPublicUrl(img.storageKey)} alt={img.name} />
                                        </div>
                                        <div>
                                            <button onClick={() => renameFile(img.storageKey)}>Rename</button>
                                            <button onClick={() => deleteFile(img.storageKey)}>Delete</button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                    </div>
                )}
            </div>
        </div>
    );
}